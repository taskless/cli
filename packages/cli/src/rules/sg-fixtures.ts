import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, sep } from "node:path";

import { parseDocument } from "yaml";

import { ruleFilePath } from "./engines";
import {
  casePassed,
  projectRelative,
  readRuleFixtures,
  type CaseOutcome,
  type FixtureCase,
  type FixtureCoverage,
  type FixtureFinding,
} from "./fixtures";
import { runAstGrepScan } from "./scan";

/**
 * An ast-grep rule's fixture cases, each judged by the scan `check` runs.
 *
 * Each case is scanned with `runAstGrepScan`, the function `check` calls,
 * with the case directory as the working directory and a config naming this
 * rule alone. ast-grep resolves `files:` and `ignores:` against the working
 * directory even when the config lives elsewhere (measured on 0.51.0), so the
 * rule's scope applies to the fixture exactly as it applies to a project: a
 * rule scoped to `.github/workflows/*.yml` fires on
 * `tests/fail/<case>/.github/workflows/ci.yml` and not on a bare `ci.yml`.
 *
 * This replaced two mechanisms. `sg test` decided the verdict, with no
 * machine-readable output and with an empty `invalid:` bucket reported as a
 * pass; a second `scan --stdin` per snippet recovered the rendered messages,
 * and stdin bypasses `files:`. Neither could see a rule whose scope matched
 * nothing real. Now the finding that decides the verdict is the finding
 * reported, and its `file` already points at the fixture.
 *
 * The config names this rule alone, in a directory of its own, so a rule
 * ast-grep refuses elsewhere in the project cannot reach this one's cases:
 * `--filter` narrows which loaded rules report, not which rules are parsed.
 */

/** What running an ast-grep rule's fixtures showed. */
export interface SgFixtureRun {
  coverage: FixtureCoverage;
  /** One per case that ran. Empty when coverage is not `"both"`, or on an error. */
  outcomes: CaseOutcome[];
  /** Why the cases could not be read or run. A failure, never a pass. */
  errors: string[];
  /** The rule's scope in its own terms, for a "scope excluded" message. */
  scope: string | undefined;
}

/** The globs out of a `files:`/`ignores:` value, in either shape ast-grep accepts. */
function globList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): unknown =>
      typeof entry === "object" && entry !== null && "glob" in entry
        ? (entry as { glob: unknown }).glob
        : entry
    )
    .filter((glob): glob is string => typeof glob === "string");
}

/**
 * The rule's scope, as `files: …; ignores: …`, or `undefined` when it declares
 * none and so cannot exclude anything.
 */
function describeScope(files: string[], ignores: string[]): string | undefined {
  const parts = [
    ...(files.length > 0 ? [`files: ${files.join(", ")}`] : []),
    ...(ignores.length > 0 ? [`ignores: ${ignores.join(", ")}`] : []),
  ];
  return parts.length === 0 ? undefined : `\`${parts.join("; ")}\``;
}

/** Write a one-rule config and its rules directory under `directory`. */
async function writeOneRuleConfig(
  directory: string,
  ruleId: string,
  source: string
): Promise<string> {
  const rules = join(directory, "rules");
  await mkdir(rules, { recursive: true });
  await writeFile(join(rules, `${ruleId}.yml`), source, "utf8");
  const configPath = join(directory, "sgconfig.yml");
  await writeFile(
    configPath,
    `ruleDirs:\n  - ${JSON.stringify(rules.split(sep).join(posix.sep))}\n`,
    "utf8"
  );
  return configPath;
}

/** Scan one case under `configPath`, with findings named project-relative. */
async function scanCase(
  cwd: string,
  ruleId: string,
  fixture: FixtureCase,
  configPath: string
): Promise<FixtureFinding[]> {
  const { results } = await runAstGrepScan(fixture.root, [], {
    configPath,
    ruleIds: [ruleId],
  });
  return results.map((result) => ({
    ...result,
    // ast-grep writes `"note": null` for a rule with no note, and the finding
    // shape `verify --json` prints has `note` as an optional string.
    note: result.note ?? undefined,
    file: projectRelative(cwd, join(fixture.root, result.file)),
    bucket: fixture.bucket,
  }));
}

/** Run every fixture case of ast-grep rule `ruleId`. */
export async function runSgFixtures(
  cwd: string,
  ruleId: string
): Promise<SgFixtureRun> {
  let fixtures;
  try {
    fixtures = await readRuleFixtures(cwd, "sg", ruleId);
  } catch (error) {
    return {
      coverage: "none",
      outcomes: [],
      errors: [error instanceof Error ? error.message : String(error)],
      scope: undefined,
    };
  }
  const { cases, coverage } = fixtures;

  const source = await readFile(ruleFilePath(cwd, "sg", ruleId), "utf8");
  const document = parseDocument(source);
  // Read through `toJS()`: `document.get` hands back the YAML node, not an
  // array, and a scope read as empty skips the unscoped run entirely.
  const values = (document.toJS() ?? {}) as Record<string, unknown>;
  const files = globList(values.files);
  const ignores = globList(values.ignores);
  const scope = describeScope(files, ignores);

  // Short-circuited before ast-grep runs: the rule has to be edited either
  // way, so there is nothing a subprocess could add that `coverage` does not.
  if (coverage !== "both") return { coverage, outcomes: [], errors: [], scope };

  const scratch = await mkdtemp(join(tmpdir(), "taskless-sg-verify-"));
  try {
    const scoped = await writeOneRuleConfig(
      join(scratch, "scoped"),
      ruleId,
      source
    );
    // The same rule with its scope removed, for the one question it answers:
    // did a quiet `fail/` case stay quiet because of the pattern or because
    // of the scope? Edited through the YAML document, so formatting and
    // comments elsewhere in the rule cannot affect it. Not written at all for
    // a rule with no scope, which cannot exclude anything.
    let unscoped: string | undefined;
    if (scope !== undefined) {
      document.delete("files");
      document.delete("ignores");
      unscoped = await writeOneRuleConfig(
        join(scratch, "unscoped"),
        ruleId,
        document.toString()
      );
    }

    const outcomes: CaseOutcome[] = [];
    for (const fixture of cases) {
      const findings = await scanCase(cwd, ruleId, fixture, scoped);
      const outcome: CaseOutcome = { fixture, findings };
      if (fixture.bucket === "fail" && !casePassed(outcome)) {
        const unscopedFindings =
          unscoped === undefined
            ? []
            : await scanCase(cwd, ruleId, fixture, unscoped);
        outcome.quiet =
          unscopedFindings.length > 0 ? "scope-excluded" : "no-match";
      }
      outcomes.push(outcome);
    }
    return { coverage, outcomes, errors: [], scope };
  } catch (error) {
    // A rule ast-grep refuses fails every case the same way, so it is
    // reported once, as the run failing, rather than as N quiet cases.
    return {
      coverage,
      outcomes: [],
      errors: [error instanceof Error ? error.message : String(error)],
      scope,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
