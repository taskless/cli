import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifyRule } from "../src/rules/verify";
import { cliRejectionToResult } from "./support/spawn-cli";
import { builtCli } from "./support/built-cli";

/**
 * An ast-grep rule's fixture cases, judged by the scan `check` runs.
 *
 * Each case under `tests/pass/<case>/` or `tests/fail/<case>/` is scanned with
 * the case directory as the working directory, so the rule's `files:` and
 * `ignores:` apply to the fixture exactly as they apply to a project. The
 * first half calls `verifyRule` for the verdicts; the second spawns the built
 * CLI, because the findings a run reports and how it prints them are
 * properties of what the command emits.
 *
 * The finding that decides a case is the finding reported, so the assertions
 * on the RENDERED message below carry the defect the old stdin re-scan existed
 * for: a rule whose message names its captures in the wrong order fires and
 * stays quiet in exactly the right places, and only that string tells the two
 * apart.
 */

const execFileAsync = promisify(execFile);
const binPath = builtCli();

let cwd: string;

async function runCli(args: string[], env?: NodeJS.ProcessEnv) {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args], {
      env: { ...process.env, ...env },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    return cliRejectionToResult(error, [binPath, ...args]);
  }
}

/** Case name → (path inside the case → contents). */
type Cases = Record<string, Record<string, string>>;

function ruleDirectory(id: string): string {
  return join(cwd, ".taskless", "rules", "sg", id);
}

/** Write rule `id` verbatim, with the given cases in each bucket. */
async function sgRule(
  id: string,
  source: string,
  buckets: { pass?: Cases; fail?: Cases } = {}
): Promise<void> {
  await mkdir(ruleDirectory(id), { recursive: true });
  await writeFile(join(ruleDirectory(id), `${id}.yml`), source);
  for (const bucket of ["pass", "fail"] as const) {
    for (const [name, files] of Object.entries(buckets[bucket] ?? {})) {
      for (const [path, contents] of Object.entries(files)) {
        const file = join(ruleDirectory(id), "tests", bucket, name, path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, contents);
      }
    }
  }
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "tskl-sg-fixtures-"));
  await runCli(["init", "-d", cwd]);
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* Verdicts                                                                    */
/* -------------------------------------------------------------------------- */

const WORKFLOW_RULE = "no-npx-latest";

/** A YAML rule scoped to workflow files, the shape the scope tests need. */
const WORKFLOW_RULE_YAML = [
  `id: ${WORKFLOW_RULE}`,
  "language: Yaml",
  "severity: error",
  "message: pin the CLI instead of running @latest",
  "files:",
  '  - ".github/workflows/*.yml"',
  "rule:",
  "  kind: string_scalar",
  "  regex: '@latest'",
  "",
].join("\n");

const OFFENDING_STEP = "steps:\n  - run: npx @taskless/cli@latest check\n";
const PINNED_STEP = "steps:\n  - run: npx @taskless/cli@0.12.0 check\n";

const EVAL_ID = "no-eval";
const EVAL_RULE = [
  `id: ${EVAL_ID}`,
  "language: TypeScript",
  "severity: error",
  "message: no eval",
  "rule:",
  "  pattern: eval($A)",
  "",
].join("\n");

/** The workflow rule with one clean case, plus `fail` as given. */
async function workflowRule(fail: Cases): Promise<void> {
  await sgRule(WORKFLOW_RULE, WORKFLOW_RULE_YAML, {
    pass: { pinned: { ".github/workflows/ci.yml": PINNED_STEP } },
    fail,
  });
}

describe("an sg fixture case is judged under the rule's scope", () => {
  it("passes a fail case whose file sits at a path the scope accepts", async () => {
    await workflowRule({
      "npx-latest": { ".github/workflows/ci.yml": OFFENDING_STEP },
    });

    const result = await verifyRule(cwd, WORKFLOW_RULE);

    expect(result.tests.errors).toEqual([]);
    expect(result.tests.valid).toBe(true);
    expect(result.tests.passed).toBe(2);
    expect(result.tests.findings.map((finding) => finding.file)).toEqual([
      `.taskless/rules/sg/${WORKFLOW_RULE}/tests/fail/npx-latest/.github/workflows/ci.yml`,
    ]);
  });

  it("fails the same file at the case root, and says the scope excluded it", async () => {
    // The pattern matches; only the path is wrong. A message that blamed the
    // pattern would send the author to edit the one part that is correct.
    await workflowRule({ "npx-latest": { "ci.yml": OFFENDING_STEP } });

    const result = await verifyRule(cwd, WORKFLOW_RULE);

    expect(result.tests.valid).toBe(false);
    expect(result.tests.failed).toBe(1);
    const errors = result.tests.errors.join("\n");
    expect(errors).toContain("scope excluded");
    expect(errors).toContain("tests/fail/npx-latest/");
    expect(errors).toContain(".github/workflows/*.yml");
    expect(errors).not.toContain("did not match");
  });

  it("says the rule did not match when the case is quiet with or without scope", async () => {
    await workflowRule({
      "no-latest": { ".github/workflows/ci.yml": "steps:\n  - run: echo hi\n" },
    });

    const result = await verifyRule(cwd, WORKFLOW_RULE);

    expect(result.tests.valid).toBe(false);
    const errors = result.tests.errors.join("\n");
    expect(errors).toContain("did not match");
    expect(errors).not.toContain("scope excluded");
  });

  it("fails the rule on a pass case that fires, reporting the finding under pass", async () => {
    await sgRule(WORKFLOW_RULE, WORKFLOW_RULE_YAML, {
      pass: { "looks-pinned": { ".github/workflows/ci.yml": OFFENDING_STEP } },
      fail: { "npx-latest": { ".github/workflows/ci.yml": OFFENDING_STEP } },
    });

    const result = await verifyRule(cwd, WORKFLOW_RULE);

    expect(result.tests.valid).toBe(false);
    expect(result.tests.errors.join("\n")).toContain("pass case wrongly fired");
    const passFindings = result.tests.findings.filter(
      (finding) => finding.bucket === "pass"
    );
    expect(passFindings.map((finding) => finding.file)).toEqual([
      `.taskless/rules/sg/${WORKFLOW_RULE}/tests/pass/looks-pinned/.github/workflows/ci.yml`,
    ]);
  });

  it("fails a pass case the scope never let the rule read", async () => {
    // A pass case passes on no finding, so one the rule never read would pass
    // on no evidence at all.
    await sgRule(WORKFLOW_RULE, WORKFLOW_RULE_YAML, {
      pass: { "outside-scope": { "ci.yml": PINNED_STEP } },
      fail: { "npx-latest": { ".github/workflows/ci.yml": OFFENDING_STEP } },
    });

    const result = await verifyRule(cwd, WORKFLOW_RULE);

    expect(result.tests.valid).toBe(false);
    const errors = result.tests.errors.join("\n");
    expect(errors).toContain("pass case was never read");
    expect(errors).toContain("scope excluded every file in it");
    expect(errors).toContain("tests/pass/outside-scope/");
  });

  it("fails a case under a path the project's .gitignore covers", async () => {
    // ast-grep walks the case as it walks a project, so the project's ignore
    // files apply to it.
    await execFileAsync("git", ["init", "-q"], { cwd });
    await writeFile(join(cwd, ".gitignore"), "dist/\n");
    await sgRule(EVAL_ID, EVAL_RULE, {
      pass: { "built-output": { "dist/a.ts": "foo(x);\n" } },
      fail: { "eval-call": { "a.ts": "eval(x);\n" } },
    });

    const result = await verifyRule(cwd, EVAL_ID);

    expect(result.tests.valid).toBe(false);
    const errors = result.tests.errors.join("\n");
    expect(errors).toContain("pass case was never read");
    expect(errors).toContain(".gitignore");
  });

  it("fails a case whose only file is empty", async () => {
    await sgRule(EVAL_ID, EVAL_RULE, {
      pass: { blank: { "a.ts": "" } },
      fail: { "eval-call": { "a.ts": "eval(x);\n" } },
    });

    const result = await verifyRule(cwd, EVAL_ID);

    expect(result.tests.errors.join("\n")).toContain(
      "pass case was never read"
    );
  });

  it("asks ast-grep what it read, so a glob dialect difference cannot hide a case", async () => {
    // In ast-grep a single `*` crosses `/`, so `*01.ts` ignores
    // `src/pass-01.ts`; in node:path's matchesGlob it does not. A check that
    // re-derived the walk would have passed this case unread.
    await sgRule(
      EVAL_ID,
      `${EVAL_RULE}files:\n  - "**/*.ts"\nignores:\n  - "*01.ts"\n`,
      {
        pass: { "pass-01": { "src/pass-01.ts": "foo(x);\n" } },
        fail: { "eval-call": { "src/a.ts": "eval(x);\n" } },
      }
    );

    const result = await verifyRule(cwd, EVAL_ID);

    expect(result.tests.errors.join("\n")).toContain(
      "pass case was never read"
    );
  });

  it("is not affected by another sg rule ast-grep refuses", async () => {
    // An unrecognised `language:` aborts parsing of whatever config holds it.
    // The rule under verification is scanned under a config naming it alone,
    // so the broken neighbour cannot reach its cases.
    await workflowRule({
      "npx-latest": { ".github/workflows/ci.yml": OFFENDING_STEP },
    });
    await sgRule(
      "broken",
      "id: broken\nlanguage: Cobolesque\nseverity: error\nmessage: m\n" +
        "rule:\n  pattern: eval($A)\n",
      { pass: { a: { "a.ts": "x;\n" } }, fail: { b: { "b.ts": "eval(x);\n" } } }
    );

    const result = await verifyRule(cwd, WORKFLOW_RULE);

    expect(result.tests.errors).toEqual([]);
    expect(result.success).toBe(true);
  });
});

describe("an sg rule's tests/ holds only case directories", () => {
  const RULE = [
    "id: no-eval",
    "language: TypeScript",
    "severity: error",
    "message: no eval",
    "rule:",
    "  pattern: eval($A)",
    "",
  ].join("\n");

  it("refuses a loose file directly in tests/pass/, naming it", async () => {
    await sgRule("no-eval", RULE, {
      fail: { "eval-call": { "sample.ts": "eval(x);\n" } },
    });
    await mkdir(join(ruleDirectory("no-eval"), "tests", "pass"));
    await writeFile(
      join(ruleDirectory("no-eval"), "tests", "pass", "loose.ts"),
      "const a = 1;\n"
    );

    const result = await verifyRule(cwd, "no-eval");

    expect(result.success).toBe(false);
    expect(result.tests.errors.join("\n")).toContain(
      join(ruleDirectory("no-eval"), "tests", "pass", "loose.ts")
    );
  });

  it("passes over operating-system metadata in tests/ and its buckets", async () => {
    await sgRule("no-eval", RULE, {
      pass: { "plain-call": { "sample.ts": "foo(x);\n" } },
      fail: { "eval-call": { "sample.ts": "eval(x);\n" } },
    });
    const tests = join(ruleDirectory("no-eval"), "tests");
    await writeFile(join(tests, ".DS_Store"), "");
    await writeFile(join(tests, "pass", ".DS_Store"), "");
    await writeFile(join(tests, "fail", ".gitkeep"), "");

    const result = await verifyRule(cwd, "no-eval");

    expect(result.tests.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("refuses a case directory with no file in it", async () => {
    await sgRule("no-eval", RULE, {
      pass: { "plain-call": { "sample.ts": "foo(x);\n" } },
      fail: { "eval-call": { "sample.ts": "eval(x);\n" } },
    });
    const empty = join(ruleDirectory("no-eval"), "tests", "pass", "empty");
    await mkdir(empty);
    await writeFile(join(empty, ".gitkeep"), "");

    const result = await verifyRule(cwd, "no-eval");

    expect(result.success).toBe(false);
    expect(result.tests.errors.join("\n")).toContain(`${empty} holds none`);
  });

  it("refuses a leftover .tests/ beside the rule, naming it", async () => {
    // What migration 12 could not convert. Nothing else would mention it.
    await sgRule("no-eval", RULE, {
      pass: { "plain-call": { "sample.ts": "foo(x);\n" } },
      fail: { "eval-call": { "sample.ts": "eval(x);\n" } },
    });
    const legacy = join(ruleDirectory("no-eval"), ".tests");
    await mkdir(legacy);
    await writeFile(join(legacy, "no-eval-test.yml"), "invalid:\n  - x\n");

    const result = await verifyRule(cwd, "no-eval");

    expect(result.success).toBe(false);
    expect(result.tests.errors.join("\n")).toContain(legacy);
  });

  it("refuses a leftover ast-grep test YAML in tests/, naming it", async () => {
    // The old fixture format. Left beside the cases it would never run, and a
    // rule whose author believes it covers something would report a pass.
    await sgRule("no-eval", RULE, {
      pass: { "plain-call": { "sample.ts": "foo(x);\n" } },
      fail: { "eval-call": { "sample.ts": "eval(x);\n" } },
    });
    await writeFile(
      join(ruleDirectory("no-eval"), "tests", "no-eval-test.yml"),
      "id: no-eval\nvalid:\n  - foo(x);\ninvalid:\n  - eval(x);\n"
    );

    const result = await verifyRule(cwd, "no-eval");

    expect(result.success).toBe(false);
    expect(result.tests.errors.join("\n")).toContain(
      join(ruleDirectory("no-eval"), "tests", "no-eval-test.yml")
    );
  });
});

/* -------------------------------------------------------------------------- */
/* What verify reports                                                         */
/* -------------------------------------------------------------------------- */

interface Finding {
  source: string;
  ruleId: string;
  severity: string;
  message: string;
  file: string;
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  matchedText: string;
  bucket: "pass" | "fail";
}

interface Report {
  ok: boolean;
  rules: {
    ruleId: string;
    ok: boolean;
    errors: string[];
    findings: Finding[];
  }[];
}

function findingsOf(report: Report, bucket?: "pass" | "fail"): Finding[] {
  const findings = report.rules.flatMap((rule) => rule.findings);
  return bucket === undefined
    ? findings
    : findings.filter((finding) => finding.bucket === bucket);
}

const SG_RULE = "swap-args";

/**
 * A rule whose message interpolates TWO metavariables in the opposite order to
 * the pattern. Both orderings fire in the same places; only the rendered
 * string tells them apart.
 */
const SG_RULE_YAML = [
  `id: ${SG_RULE}`,
  "language: TypeScript",
  "severity: warning",
  "message: replace $SECOND with $FIRST",
  "rule:",
  "  pattern: swap($FIRST, $SECOND)",
  "",
].join("\n");

/** What the rule above renders for `swap(alpha, beta)`. */
const SG_RENDERED = "replace beta with alpha";

/** The message a rule with the slots the other way round would render. */
const SG_REVERSED = "replace alpha with beta";

/** The fixture file a `fail` finding must point back at, project-relative. */
const SG_FAIL_FILE = `.taskless/rules/sg/${SG_RULE}/tests/fail/swapped/sample.ts`;
const SG_PASS_FILE = `.taskless/rules/sg/${SG_RULE}/tests/pass/unrelated/sample.ts`;

async function writeSwapRule(options: { passFires?: boolean } = {}) {
  await rm(ruleDirectory(SG_RULE), { recursive: true, force: true });
  await sgRule(SG_RULE, SG_RULE_YAML, {
    pass: {
      unrelated: {
        "sample.ts":
          (options.passFires ?? false)
            ? "const fine = 1;\nswap(one, two);\n"
            : "const fine = 1;\n",
      },
    },
    fail: { swapped: { "sample.ts": "swap(alpha, beta);\n" } },
  });
}

async function testSg(...extra: string[]) {
  return runCli([
    "verify",
    `.taskless/rules/sg/${SG_RULE}`,
    "-d",
    cwd,
    ...extra,
  ]);
}

describe("an ast-grep rule's fixture findings", () => {
  it("reports the rendered message, so swapped metavariables cannot pass", async () => {
    await writeSwapRule();

    const { stdout, exitCode } = await testSg("--json");
    const report = JSON.parse(stdout) as Report;

    expect(exitCode).toBe(0);
    expect(report.ok).toBe(true);
    const messages = findingsOf(report).map((finding) => finding.message);
    expect(messages).toEqual([SG_RENDERED]);
    expect(messages).not.toContain(SG_REVERSED);
  });

  it("carries the whole check finding, naming the fixture file project-relative", async () => {
    // The case is scanned in place, so `file` is the real fixture and its range
    // the real coordinates in it: a path the author can open and go to.
    await writeSwapRule();

    const { stdout } = await testSg("--json");
    const report = JSON.parse(stdout) as Report;
    const finding = findingsOf(report)[0];

    expect(finding).toBeDefined();
    expect(finding?.source).toBe("ast-grep");
    expect(finding?.ruleId).toBe(SG_RULE);
    expect(finding?.severity).toBe("warning");
    expect(finding?.matchedText).toBe("swap(alpha, beta)");
    expect(finding?.file).toBe(SG_FAIL_FILE);
    expect(finding?.range.start).toEqual({ line: 0, column: 0 });
  });

  it("reports the fail bucket on a run that passed", async () => {
    await writeSwapRule();

    const { stdout } = await testSg("--json");
    const report = JSON.parse(stdout) as Report;

    expect(report.rules[0]?.ok).toBe(true);
    expect(findingsOf(report, "fail")).toHaveLength(1);
    expect(findingsOf(report, "pass")).toHaveLength(0);
  });

  it("reports both buckets when a pass case fires", async () => {
    await writeSwapRule({ passFires: true });

    const { stdout, exitCode } = await testSg("--json");
    const report = JSON.parse(stdout) as Report;

    expect(exitCode).toBe(1);
    expect(report.ok).toBe(false);
    expect(findingsOf(report, "fail").map((finding) => finding.file)).toEqual([
      SG_FAIL_FILE,
    ]);
    const passFindings = findingsOf(report, "pass");
    expect(passFindings).toHaveLength(1);
    expect(passFindings[0]?.file).toBe(SG_PASS_FILE);
    expect(passFindings[0]?.message).toBe("replace two with one");
    expect(passFindings[0]?.range.start.line).toBe(1);
  });

  it("prints one line and no findings when the rule passed", async () => {
    await writeSwapRule();

    const { stdout } = await testSg();

    expect(stdout).toContain(`✓ sg/${SG_RULE}`);
    expect(stdout).not.toContain(SG_RENDERED);
    expect(stdout).not.toContain("fixture findings");
  });

  it("prints the pass-bucket finding under a failing rule, through check's renderer", async () => {
    await writeSwapRule({ passFires: true });

    const { stdout } = await testSg();

    expect(stdout).toContain(`✗ sg/${SG_RULE}`);
    expect(stdout).toContain("pass fixture findings:");
    // `check`'s own renderer, so a finding does not read two ways depending on
    // which command surfaced it, with a file and line a reader can go to.
    expect(stdout).toContain(`warning[${SG_RULE}] replace two with one`);
    expect(stdout).toContain(`${SG_PASS_FILE}:2:1`);
  });

  it("refuses an unparseable language without taking down another rule", async () => {
    // ast-grep cannot deserialise the language, so it refuses the file
    // outright. That fails this rule, with no findings rather than a crash or
    // an absent key, and leaves the rule beside it judged on its own cases.
    await writeSwapRule();
    await sgRule(
      "broken",
      SG_RULE_YAML.replace(`id: ${SG_RULE}`, "id: broken").replace(
        "language: TypeScript",
        "language: Cobolesque"
      ),
      {
        pass: { fine: { "sample.ts": "const fine = 1;\n" } },
        fail: { swapped: { "sample.ts": "swap(alpha, beta);\n" } },
      }
    );

    const { stdout } = await runCli([
      "verify",
      ".taskless/rules/sg",
      "-d",
      cwd,
      "--json",
    ]);
    const report = JSON.parse(stdout) as Report;
    const byId = Object.fromEntries(
      report.rules.map((rule) => [rule.ruleId, rule])
    );

    expect(byId.broken?.ok).toBe(false);
    expect(byId.broken?.findings).toEqual([]);
    expect(byId[SG_RULE]?.ok).toBe(true);
    expect(byId[SG_RULE]?.findings.map((finding) => finding.message)).toEqual([
      SG_RENDERED,
    ]);
  });

  it("leaves nothing behind, on a passing run or a failing one", async () => {
    // Everything a case run assembles lives in a temporary directory that is
    // removed when the run ends, and nothing is written into the rules tree
    // where a later `check` could pick it up.
    //
    // The CLI's whole temp directory is redirected to a private one rather than
    // diffing the shared `tmpdir()`, which other suites are writing to
    // concurrently.
    const temporary = await mkdtemp(join(tmpdir(), "tskl-sg-tmp-"));
    const environment = { TMPDIR: temporary, TMP: temporary, TEMP: temporary };
    try {
      await writeSwapRule();
      const passing = await runCli(
        ["verify", `.taskless/rules/sg/${SG_RULE}`, "-d", cwd, "--json"],
        environment
      );
      expect(passing.exitCode).toBe(0);
      expect(await readdir(temporary)).toEqual([]);

      await writeSwapRule({ passFires: true });
      const failing = await runCli(
        ["verify", `.taskless/rules/sg/${SG_RULE}`, "-d", cwd, "--json"],
        environment
      );
      expect(failing.exitCode).toBe(1);
      expect(await readdir(temporary)).toEqual([]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }

    const ruleEntries = await readdir(ruleDirectory(SG_RULE));
    expect(ruleEntries.toSorted()).toEqual([`${SG_RULE}.yml`, "tests"]);
    const buckets = await readdir(join(ruleDirectory(SG_RULE), "tests"));
    expect(buckets.toSorted()).toEqual(["fail", "pass"]);
    expect(
      await readdir(join(ruleDirectory(SG_RULE), "tests", "fail", "swapped"))
    ).toEqual(["sample.ts"]);
  });
});
