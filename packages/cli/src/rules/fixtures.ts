import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";

import { ruleDirectory, ruleTestsDirectory } from "./engines";
import { isMissingDirectory } from "./errno";
import { LEGACY_RULE_TESTS_DIRECTORY, type EngineName } from "./layout";
import type { CheckResult } from "../types/check";

/**
 * A rule's fixtures, read and judged the same way for every engine.
 *
 * Every rule keeps its fixtures at `tests/pass/<case>/` and
 * `tests/fail/<case>/`. A case is a directory, and the engine's own check is
 * run with it as the root: a `fail/` case passes on at least one finding for
 * the rule, a `pass/` case on none. Nothing about position, message or count
 * is asserted.
 *
 * This replaced three readers that each rejected a different layout (Vale
 * refused a nested directory, runtime a loose file, and ast-grep read its own
 * `valid:`/`invalid:` YAML), judged by three mechanisms of which only
 * runtime's was the one `check` runs. A rule whose scope matched no real file
 * passed its fixtures and reported nothing in `check`.
 */

/**
 * The two buckets a fixture lives in.
 *
 * Part of what `verify` REPORTS, not only of how fixtures are read: a consumer
 * reading `findings[].bucket` reads this vocabulary.
 */
export type FixtureBucket = "pass" | "fail";

/**
 * One finding a fixture produced, with the bucket that produced it.
 *
 * {@link CheckResult} verbatim, which is deliberate: it is already the shape
 * `check --json` prints, so a finding means the same thing whichever command
 * surfaced it. `bucket` is the only addition, and it is the half a
 * `CheckResult` cannot carry: a finding does not know whether the document it
 * came from was supposed to be clean.
 */
export interface FixtureFinding extends CheckResult {
  bucket: FixtureBucket;
}

/**
 * One fixture case: a DIRECTORY, whose path is the root the engine is run over.
 */
export interface FixtureCase {
  bucket: FixtureBucket;
  /** The case directory's own name, which is the case's description. */
  name: string;
  /** Absolute path, and the root the check will be given. */
  root: string;
}

/**
 * Which buckets a rule actually populated.
 *
 * Four states rather than a boolean, because a caller wants to say different
 * things about them: `"none"` is an unwritten rule, while a `-only` is a
 * half-written one, which is the more misleading of the two. A rule with only
 * failing cases has shown it fires and not that it stays quiet; a rule with
 * only passing ones has shown the opposite. Only `"both"` can reach a pass.
 */
export type FixtureCoverage = "both" | "pass-only" | "fail-only" | "none";

/** Classify a rule's buckets by how many cases each held. */
export function classifyCoverage(
  passCount: number,
  failCount: number
): FixtureCoverage {
  if (passCount > 0 && failCount > 0) return "both";
  if (passCount > 0) return "pass-only";
  if (failCount > 0) return "fail-only";
  return "none";
}

/**
 * What `verify` says about coverage that is not `"both"`, or nothing when it is.
 */
export function describeCoverageShortfall(
  ruleId: string,
  coverage: FixtureCoverage
): string | undefined {
  if (coverage === "both") return undefined;
  return coverage === "none"
    ? `${ruleId} has no fixtures, so nothing shows it fires or stays quiet.`
    : `${ruleId} has only ${coverage.replace("-only", "")}/ fixtures — half a claim.`;
}

/**
 * Directory entries, with a directory that is not there reading as an empty one.
 *
 * The single place that decides which `readdir` failures are absence and which
 * are problems. Buckets are read independently, and this discrimination is why
 * that is safe: swallowing an `EACCES` on `pass/` would yield `[]` while
 * `fail/` still had cases, so the rule would not look one-sided and could
 * report a pass having never checked the pass side at all. A permissions
 * problem must not read as "no pass fixtures were written".
 */
export async function bucketEntries(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectory(error)) return [];
    throw error;
  }
}

/**
 * Entries no author wrote as a fixture: operating-system metadata, and the
 * `.gitkeep` that keeps an empty directory in git. Skipped wherever fixtures
 * are read. Refusing a `.DS_Store` beside `pass/` would fail a rule over a
 * file Finder wrote.
 */
const NOT_FIXTURES: ReadonlySet<string> = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  ".gitkeep",
]);

/** Directory entries that are fixtures, see {@link NOT_FIXTURES}. */
async function fixtureEntries(directory: string): Promise<Dirent[]> {
  const entries = await bucketEntries(directory);
  return entries.filter((entry) => !NOT_FIXTURES.has(entry.name));
}

/**
 * Whether a case directory holds at least one file, at any depth.
 *
 * An empty case tests nothing: a `pass/` case with no file passes on no
 * evidence, and git does not keep an empty directory, so the case would
 * vanish from every clone.
 */
async function caseHoldsAFile(root: string): Promise<boolean> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.some(
    (entry) => !entry.isDirectory() && !NOT_FIXTURES.has(entry.name)
  );
}

/**
 * The cases in one bucket, one level deep.
 *
 * Every entry must be a directory, and a loose file is an error naming its own
 * path rather than an entry quietly skipped. The engine is handed a root and
 * walks whatever is beneath it, so a file has no root to be: ignoring it would
 * leave an author with a fixture they wrote, that never ran, and that nothing
 * mentioned.
 */
async function bucketCases(
  testsDirectory: string,
  bucket: FixtureBucket
): Promise<FixtureCase[]> {
  const directory = join(testsDirectory, bucket);
  const entries = await fixtureEntries(directory);

  const loose = entries.find((entry) => !entry.isDirectory());
  if (loose !== undefined) {
    throw new Error(
      `A fixture case is a directory: ${join(directory, loose.name)} is not ` +
        `one. Each case is run with its directory as the root, so a bare file ` +
        `in ${bucket}/ has no root to be and would never run. Move it into ` +
        `${bucket}/<case>/, naming the case for what it shows.`
    );
  }

  const cases = entries
    .map((entry) => ({
      bucket,
      name: entry.name,
      root: join(directory, entry.name),
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  for (const fixture of cases) {
    if (!(await caseHoldsAFile(fixture.root))) {
      throw new Error(
        `A fixture case holds at least one file: ${fixture.root} holds none. ` +
          `An empty case tests nothing, and git does not keep an empty ` +
          `directory. Add the file the case is about, or remove the case.`
      );
    }
  }
  return cases;
}

/** Every fixture case a rule holds, with what the buckets cover. */
export interface RuleFixtures {
  cases: FixtureCase[];
  coverage: FixtureCoverage;
}

/**
 * Read a rule's fixture cases from `tests/pass/` and `tests/fail/`.
 *
 * An entry directly under `tests/` other than the two buckets is refused,
 * naming it. The case it most often is: an ast-grep test YAML left behind,
 * which would otherwise sit beside the cases and never run. A legacy
 * `.tests/` beside the rule is refused for the same reason: it holds what
 * migration 12 could not convert, and nothing else would ever mention it.
 *
 * Reads the buckets independently rather than walking `tests/` once, so an
 * unreadable bucket surfaces as itself instead of as an absence.
 */
export async function readRuleFixtures(
  cwd: string,
  engine: EngineName,
  ruleId: string
): Promise<RuleFixtures> {
  const testsDirectory = ruleTestsDirectory(cwd, engine, ruleId);

  const legacy = join(
    ruleDirectory(cwd, engine, ruleId),
    LEGACY_RULE_TESTS_DIRECTORY
  );
  const leftover = await fixtureEntries(legacy);
  if (leftover.length > 0) {
    throw new Error(
      `${legacy} still holds fixtures in the old layout, which nothing runs. ` +
        `Migration 12 leaves there what it could not convert. Move each into ` +
        `tests/pass/<case>/ or tests/fail/<case>/, then delete the directory.`
    );
  }

  const entries = await fixtureEntries(testsDirectory);
  const stray = entries.find(
    (entry) => entry.name !== "pass" && entry.name !== "fail"
  );
  if (stray !== undefined) {
    throw new Error(
      `${join(testsDirectory, stray.name)} is not a fixture bucket. A rule's ` +
        `tests/ holds only pass/ and fail/, each with one directory per case, ` +
        `so anything else beside them would never run.`
    );
  }

  const [pass, fail] = await Promise.all([
    bucketCases(testsDirectory, "pass"),
    bucketCases(testsDirectory, "fail"),
  ]);

  return {
    cases: [...fail, ...pass],
    coverage: classifyCoverage(pass.length, fail.length),
  };
}

/** A path relative to `cwd`, with `/` separators on every platform. */
export function projectRelative(cwd: string, absolute: string): string {
  return relative(cwd, absolute).split(sep).join(posix.sep);
}

/**
 * How one case came out, for the two engines whose check is a scan
 * (`sg` and `vale`).
 *
 * `quiet` is set only on a `fail/` case that produced no finding, and says
 * which of the two causes it was: the rule's scope excluded every file in the
 * case (`"scope-excluded"`, decided by running the case again without scope),
 * or the rule did not match (`"no-match"`). The verdict is the same either way.
 * Only the message differs, and that difference is what tells an author
 * whether to edit the fixture's path or the pattern.
 *
 * `unread` is set on a case, of either bucket, whose files the rule never
 * read, and fails it whatever it found. A case the engine never read proves
 * nothing: a `pass/` case would pass on no evidence and a `fail/` one would
 * blame the pattern. `"scope-excluded"` means the scope admitted no file in
 * the case (the rule reads one with the scope removed); `"not-walked"` means
 * the walk itself reached none, because the project's ignore files cover
 * them, they are empty, or no file is in a language or format the engine
 * reads. Detected from the engine itself (ast-grep's `--inspect`, a Vale
 * probe rule under the same matchers), not from a glob reimplementation, so
 * a glob dialect difference cannot hide it.
 */
export interface CaseOutcome {
  fixture: FixtureCase;
  findings: FixtureFinding[];
  quiet?: "scope-excluded" | "no-match";
  unread?: "scope-excluded" | "not-walked";
}

/** Whether a case came out the way its bucket asserts. */
export function casePassed(outcome: CaseOutcome): boolean {
  if (outcome.unread !== undefined) return false;
  return outcome.fixture.bucket === "fail"
    ? outcome.findings.length > 0
    : outcome.findings.length === 0;
}

/**
 * One error line per case that did not come out as its bucket asserts.
 *
 * `scope` names what was in effect, in the rule's own terms (the `files:`
 * globs, or the Vale matchers), so a "scope excluded" message points at the
 * exact text an author would edit.
 */
export function describeCaseFailures(
  cwd: string,
  outcomes: readonly CaseOutcome[],
  scope: string | undefined
): string[] {
  const errors: string[] = [];
  for (const outcome of outcomes) {
    if (casePassed(outcome)) continue;
    const path = projectRelative(cwd, outcome.fixture.root);
    if (outcome.unread === "scope-excluded") {
      errors.push(
        `${outcome.fixture.bucket} case was never read, because the rule's ` +
          `scope excluded every file in it: ${path}/. No file sits at a path ` +
          `admitted by ${scope ?? "the scope"}. Move the fixture to such a path.`
      );
    } else if (outcome.unread === "not-walked") {
      errors.push(
        `${outcome.fixture.bucket} case was never read: ${path}/. The engine ` +
          `walked no file in it, even with the scope removed: the project's ` +
          `.gitignore or .ignore covers them, they are empty, or none is in a ` +
          `language or format the engine reads. Rename the path or the file.`
      );
    } else if (outcome.fixture.bucket === "pass") {
      errors.push(`pass case wrongly fired: ${path}/`);
    } else if (outcome.quiet === "scope-excluded") {
      errors.push(
        `fail case did not fire because the rule's scope excluded it: ${path}/. ` +
          `It fires with the scope removed, so the pattern matches, and no ` +
          `file in the case sits at a path admitted by ${scope ?? "the scope"}. ` +
          `Move the fixture to such a path, or widen the scope.`
      );
    } else {
      errors.push(
        `fail case did not fire: ${path}/ (the rule did not match it)`
      );
    }
  }
  return errors;
}
