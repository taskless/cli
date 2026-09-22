import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractRuleFilters } from "../src/commands/check";
import { sgFilterArgv } from "../src/rules/scan";
import { findValeBinary } from "../src/rules/vale/binary";
import { migrateFixture } from "./support/current-project";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");
const fixturesDirectory = resolve(
  import.meta.dirname,
  "fixtures/mixed-engines-project"
);

/**
 * `check --rule <id>` over a project with rules in both static engines.
 *
 * The flag exists so an author can measure ONE rule over the whole repository
 * while iterating on it, instead of running every rule and filtering the JSON
 * afterwards (taskless/cli#379). That makes the load-bearing claim a claim
 * about equality: what `--rule <id>` reports has to be exactly what an
 * unfiltered `check` reports for that id — the same walk, the same exclusions,
 * the same findings — or the number the author records against a branch is not
 * the number `check` would have produced.
 *
 * Spawns the built CLI over a real project, because the two engines narrow by
 * different mechanisms (ast-grep's `--filter`, a Vale config assembled from
 * only the selected rules) and the question is whether those two mechanisms
 * agree with the unfiltered run. A mock of either would be asserting the mock.
 */

/** Run the built CLI, tolerating a non-zero exit. */
async function runCli(
  arguments_: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await migrateFixture(arguments_);

  try {
    const { stdout, stderr } = await execFileAsync("node", [
      binPath,
      ...arguments_,
    ]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout: string; stderr: string; code: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: failure.code,
    };
  }
}

interface CheckFinding {
  source: string;
  ruleId: string;
  file: string;
}

interface CheckOutput {
  success: boolean;
  results: CheckFinding[];
}

/** `(source, ruleId, file)` triples, sorted, for order-free comparison. */
function triples(results: CheckFinding[]): string[] {
  return results
    .map((finding) => `${finding.source} ${finding.ruleId} ${finding.file}`)
    .toSorted();
}

/** Vale ships per-platform; an unsupported host has none. */
const valeAvailable = findValeBinary().path !== undefined;

describe("extractRuleFilters", () => {
  it("collects every --rule value, in both spellings", () => {
    expect(
      extractRuleFilters(["check", "--rule", "a", "--json", "--rule=b"])
    ).toEqual(["a", "b"]);
  });

  it("stops at the end-of-options marker", () => {
    // After `--` every token is a path, including one spelled like this flag.
    expect(extractRuleFilters(["check", "--", "--rule", "a"])).toEqual([]);
  });
});

describe("sgFilterArgv", () => {
  it("anchors the alternation so an id is not a prefix match", () => {
    // Unanchored, `no-eval` would also report `no-eval-in-tests`.
    expect(sgFilterArgv(["no-eval", "no-console-warn"])).toEqual([
      "--filter",
      "^(?:no-eval|no-console-warn)$",
    ]);
  });

  it("passes no filter when nothing is selected", () => {
    const unselected: string[] | undefined = undefined;
    expect(sgFilterArgv(unselected)).toEqual([]);
    expect(sgFilterArgv([])).toEqual([]);
  });
});

describe("check --rule", () => {
  let project: string;

  async function check(...arguments_: string[]): Promise<CheckOutput> {
    const { stdout } = await runCli([
      "check",
      "-d",
      project,
      "--json",
      ...arguments_,
    ]);
    return JSON.parse(stdout.trim()) as CheckOutput;
  }

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "taskless-rule-filter-"));
    await cp(fixturesDirectory, project, { recursive: true });
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it("narrows an ast-grep run to the named rule", async () => {
    const filtered = await check("--rule", "no-eval");

    expect(triples(filtered.results)).toEqual(["ast-grep no-eval sample.js"]);
    // The flag's value is not a path: were it scanned as one it would not
    // exist, and `check` would take its "every supplied path was filtered out"
    // branch — an empty result set that looks exactly like a rule that never
    // fires.
    expect(filtered.results.length).toBeGreaterThan(0);
  });

  it("errors naming an id no rule directory has", async () => {
    const { stdout, exitCode } = await runCli([
      "check",
      "-d",
      project,
      "--json",
      "--rule",
      "no-such-rule",
    ]);
    const envelope = JSON.parse(stdout.trim()) as {
      ok: boolean;
      code: string;
      message: string;
    };

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("RULE_NOT_FOUND");
    // Naming the id is the whole point: a typo that measured nothing would
    // report "0 findings", which is also what a clean rule reports.
    expect(envelope.message).toContain("no-such-rule");
    expect(exitCode).toBe(1);
  });

  it("reports exactly what an unfiltered run reports for that rule", async () => {
    const everything = await check();
    const filtered = await check("--rule", "no-console-warn");

    expect(triples(filtered.results)).toEqual(
      triples(
        everything.results.filter(
          (finding) => finding.ruleId === "no-console-warn"
        )
      )
    );
    // Only warnings survive the filter, so the run that failed on `no-eval`
    // now succeeds — the filter reaches the exit code, not just the output.
    expect(everything.success).toBe(false);
    expect(filtered.success).toBe(true);
  });

  describe("with a gitignored copy of the project's files", () => {
    beforeEach(async () => {
      await mkdir(join(project, "ignored"), { recursive: true });
      await cp(join(project, "README.md"), join(project, "ignored/README.md"));
      await cp(join(project, "sample.js"), join(project, "ignored/sample.js"));
      await writeFile(join(project, ".gitignore"), "ignored/\n");
      await execFileAsync("git", ["init", "--quiet"], { cwd: project });
    });

    it("keeps the exclusions a whole-project run applies", async () => {
      const filtered = await check("--rule", "no-eval");

      // Not vacuous: the tracked copy of the same file still fires.
      expect(triples(filtered.results)).toEqual(["ast-grep no-eval sample.js"]);
    });
  });

  const withVale = valeAvailable ? describe : describe.skip;

  withVale("with the Vale binary available", () => {
    it("narrows a Vale run to the named rule", async () => {
      const filtered = await check("--rule", "no-obviously");

      expect(triples(filtered.results)).toEqual([
        "vale no-obviously README.md",
      ]);
    });

    it("unions repeated --rule across both engines", async () => {
      const filtered = await check("--rule", "no-eval", "--rule", "no-simply");

      expect(triples(filtered.results)).toEqual([
        "ast-grep no-eval sample.js",
        "vale no-simply README.md",
      ]);
    });

    it("matches the unfiltered run for a Vale rule, scope included", async () => {
      const everything = await check();
      const filtered = await check("--rule", "no-obviously");

      // The equality that matters for Vale: each rule's own matchers are kept
      // verbatim in the filtered config, so removing the other rules cannot
      // change this one's scope.
      expect(triples(filtered.results)).toEqual(
        triples(
          everything.results.filter(
            (finding) => finding.ruleId === "no-obviously"
          )
        )
      );
    });

    it("selects both rules when two engines hold the id", async () => {
      // `rules delete` refuses an ambiguous id because deleting the wrong rule
      // is irreversible. Measuring is not, and an unfiltered `check` would have
      // run both, so both run and `source` tells them apart.
      const valeRule = join(project, ".taskless/rules/vale/no-eval");
      await mkdir(valeRule, { recursive: true });
      await writeFile(
        join(valeRule, "no-eval.yml"),
        [
          "extends: existence",
          "message: \"Avoid 'objectionable'\"",
          "level: warning",
          "tokens:",
          "  - objectionable",
          "",
        ].join("\n")
      );
      await writeFile(
        join(valeRule, ".vale.ini"),
        ["[*.md]", "tskl) rule = no-eval", "no-eval.no-eval = YES", ""].join(
          "\n"
        )
      );

      const filtered = await check("--rule", "no-eval");

      expect(triples(filtered.results)).toEqual([
        "ast-grep no-eval sample.js",
        "vale no-eval README.md",
      ]);
    });

    it("keeps a gitignored copy out of a filtered Vale run", async () => {
      await mkdir(join(project, "ignored"), { recursive: true });
      await cp(join(project, "README.md"), join(project, "ignored/README.md"));
      await writeFile(join(project, ".gitignore"), "ignored/\n");
      await execFileAsync("git", ["init", "--quiet"], { cwd: project });

      const filtered = await check("--rule", "no-obviously");

      expect(triples(filtered.results)).toEqual([
        "vale no-obviously README.md",
      ]);
    });
  });
});
