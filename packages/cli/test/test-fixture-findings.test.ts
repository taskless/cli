import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";
import { cliRejectionToResult } from "./support/spawn-cli";

/**
 * The findings `test` reports, per rule and per fixture bucket.
 *
 * The defect this file exists for: `test --json` reported a boolean per rule
 * and nothing else, while the findings that produced the boolean were in hand
 * and thrown away — Vale's reduced to a `Set` of file paths, runtime's to
 * `findings.length`. A rule whose message interpolates its captures can have
 * the slots in the wrong order, fire on every `fail/` fixture, stay quiet on
 * every `pass/` one, and be reported as a rule that passed. The RENDERED
 * message is the only evidence otherwise, so the assertions on it below are the
 * point of the whole file and must not be relaxed to "some message".
 *
 * These spawn the built CLI rather than calling `testOneRule`, because the
 * always-present `findings` key and the human rendering are both properties of
 * what the command prints.
 */

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

const withVale = findValeBinary().path === undefined ? describe.skip : describe;

let cwd: string;

async function runCli(args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    return cliRejectionToResult(error, [binPath, ...args]);
  }
}

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
    engine: string;
    ruleId: string;
    ok: boolean;
    errors: string[];
    ran?: boolean;
    refused?: string;
    findings: Finding[];
  }[];
}

function findingsOf(report: Report, bucket?: "pass" | "fail"): Finding[] {
  const findings = report.rules.flatMap((rule) => rule.findings);
  return bucket === undefined
    ? findings
    : findings.filter((finding) => finding.bucket === bucket);
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "tskl-findings-"));
  await runCli(["init", "-d", cwd]);
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* Vale                                                                        */
/* -------------------------------------------------------------------------- */

const VALE_RULE = "use-email";

/**
 * A `substitution` rule, chosen deliberately over `existence`.
 *
 * `substitution` is the check whose message takes TWO `%s` slots — the
 * replacement and the match — so it is the one that can be wrong in the way a
 * verdict cannot see. Vale fills them in that order, which is the opposite of
 * the order they appear in the swap, and an author who assumes otherwise ships
 * a rule that tells every reader to replace `email` with `e-mail`.
 */
const SUBSTITUTION_STYLE = [
  "extends: substitution",
  `message: "Use '%s' instead of '%s'"`,
  "level: warning",
  "ignorecase: true",
  "swap:",
  "  e-mail: email",
  "",
].join("\n");

const VALE_CONFIG = [
  "[*.md]",
  `tskl) rule = ${VALE_RULE}`,
  `${VALE_RULE}.${VALE_RULE} = YES`,
  "",
].join("\n");

/** The message Vale renders, with the slots in the order Vale fills them. */
const RENDERED = "Use 'email' instead of 'e-mail'";

async function writeValeRule(options: { passFires?: boolean } = {}) {
  const directory = join(cwd, ".taskless", "rules", "vale", VALE_RULE);
  await mkdir(join(directory, ".tests", "pass"), { recursive: true });
  await mkdir(join(directory, ".tests", "fail"), { recursive: true });
  await writeFile(join(directory, `${VALE_RULE}.yml`), SUBSTITUTION_STYLE);
  await writeFile(join(directory, ".vale.ini"), VALE_CONFIG);
  await writeFile(
    join(directory, ".tests", "fail", "bad.md"),
    "Send an e-mail today.\n"
  );
  await writeFile(
    join(directory, ".tests", "pass", "ok.md"),
    (options.passFires ?? false)
      ? "Send an e-mail now.\n"
      : "Send an email today.\n"
  );
}

async function testVale(...extra: string[]) {
  return runCli([
    "test",
    `.taskless/rules/vale/${VALE_RULE}`,
    "-d",
    cwd,
    ...extra,
  ]);
}

withVale("a Vale rule's fixture findings", () => {
  it("reports the rendered message, so a swapped %s pair cannot pass", async () => {
    // THE test. `substitution` renders replacement-then-match; a rule written
    // the other way round renders "Use 'e-mail' instead of 'email'" and fires
    // and stays quiet in exactly the same places, so nothing but this string
    // distinguishes the two.
    await writeValeRule();

    const { stdout, exitCode } = await testVale("--json");
    const report = JSON.parse(stdout) as Report;

    expect(exitCode).toBe(0);
    expect(report.ok).toBe(true);
    const messages = findingsOf(report).map((finding) => finding.message);
    expect(messages).toEqual([RENDERED]);
    expect(messages).not.toContain("Use 'e-mail' instead of 'email'");
  });

  it("carries the whole check finding, not a summary of one", async () => {
    await writeValeRule();

    const { stdout } = await testVale("--json");
    const report = JSON.parse(stdout) as Report;
    const finding = findingsOf(report)[0];

    expect(finding).toBeDefined();
    expect(finding?.source).toBe("vale");
    expect(finding?.ruleId).toBe(VALE_RULE);
    expect(finding?.severity).toBe("warning");
    expect(finding?.matchedText).toBe("e-mail");
    expect(finding?.file).toContain("fail/bad.md");
    expect(finding?.range.start.line).toBe(0);
    expect(finding?.range.start.column).toBe(8);
  });

  it("reports the fail bucket on a run that passed", async () => {
    // The evidence is only ever produced by a green run. A payload that
    // carried it once the rule was already failing would carry it at the one
    // moment nobody needs it.
    await writeValeRule();

    const { stdout } = await testVale("--json");
    const report = JSON.parse(stdout) as Report;

    expect(report.rules[0]?.ok).toBe(true);
    expect(findingsOf(report, "fail")).toHaveLength(1);
    expect(findingsOf(report, "pass")).toHaveLength(0);
  });

  it("tags a wrongly-fired pass fixture as the pass bucket", async () => {
    await writeValeRule({ passFires: true });

    const { stdout, exitCode } = await testVale("--json");
    const report = JSON.parse(stdout) as Report;

    expect(exitCode).toBe(1);
    expect(report.ok).toBe(false);
    const passFindings = findingsOf(report, "pass");
    expect(passFindings).toHaveLength(1);
    expect(passFindings[0]?.file).toContain("pass/ok.md");
    expect(passFindings[0]?.message).toBe(RENDERED);
  });

  it("prints one line and no findings when the rule passed", async () => {
    // The human path stays scannable. A wall of ticks is the format's whole
    // value, and the evidence goes to `--json`, where something reads it on
    // purpose.
    await writeValeRule();

    const { stdout } = await testVale();

    expect(stdout).toContain(`✓ vale/${VALE_RULE}`);
    expect(stdout).not.toContain(RENDERED);
    expect(stdout).not.toContain("fixture findings");
  });

  it("prints what matched under a failing rule, not only which file", async () => {
    // `pass fixture wrongly fired: <file>` says THAT it happened. The author
    // still has to open the file to learn what matched, which is the one thing
    // they need to fix it.
    await writeValeRule({ passFires: true });

    const { stdout } = await testVale();

    expect(stdout).toContain(`✗ vale/${VALE_RULE}`);
    expect(stdout).toContain("pass fixture wrongly fired:");
    expect(stdout).toContain("pass fixture findings:");
    expect(stdout).toContain(RENDERED);
    // `check`'s own renderer, so a finding does not read two ways depending on
    // which command surfaced it.
    expect(stdout).toContain(`warning[${VALE_RULE}] ${RENDERED}`);
    expect(stdout).toContain("> e-mail");
  });
});

/* -------------------------------------------------------------------------- */
/* Runtime                                                                     */
/* -------------------------------------------------------------------------- */

const RUNTIME_RULE = "no-eval";

const EVAL_CAPTURE = [
  "id: no-eval-abc12345",
  "language: typescript",
  "rule:",
  "  pattern: eval($ARG)",
  "metadata:",
  "  taskless:",
  "    version: 1",
  "    kind: runtime",
  "    name: no-eval",
  "    check: check.ts",
  "    match: anchor",
  "",
].join("\n");

const RUNTIME_MESSAGE = "eval on a non-literal is not allowed";

/** Reports only where the argument is not a literal, so a pass case can run. */
const FLAGS_DYNAMIC_EVAL = String.raw`import { readFileSync } from "node:fs";
import { join } from "node:path";

export default async function (root, matches) {
  return matches
    .filter((m) => !readFileSync(join(root, m.file), "utf8").includes('eval("'))
    .map((m) => ({
      file: m.file,
      line: m.line,
      column: m.column,
      message: "${RUNTIME_MESSAGE}",
      severity: "warning",
    }));
}
`;

/** Reports every match, so the `pass/` case wrongly fires. */
const FLAGS_EVERY_MATCH = `export default async function (root, matches) {
  return matches.map((m) => ({
    file: m.file,
    line: m.line,
    column: m.column,
    message: "${RUNTIME_MESSAGE}",
    severity: "warning",
  }));
}
`;

async function writeRuntimeRule(check: string = FLAGS_DYNAMIC_EVAL) {
  const directory = join(cwd, ".taskless", "rules", "runtime", RUNTIME_RULE);
  await mkdir(join(directory, "captures"), { recursive: true });
  await writeFile(join(directory, "captures", "eval.yml"), EVAL_CAPTURE);
  await writeFile(join(directory, "check.ts"), check);

  for (const [bucket, source] of [
    ["fail", "const input = globalThis.userInput;\neval(input);\n"],
    ["pass", 'eval("1 + 1");\n'],
  ] as const) {
    const caseDirectory = join(directory, ".tests", bucket, `${bucket}-case`);
    await mkdir(caseDirectory, { recursive: true });
    await writeFile(join(caseDirectory, "sample.ts"), source);
  }
}

async function testRuntime(...extra: string[]) {
  return runCli([
    "test",
    `.taskless/rules/runtime/${RUNTIME_RULE}`,
    "-d",
    cwd,
    "--dangerously-run-scripts",
    ...extra,
  ]);
}

describe("a runtime rule's fixture findings", () => {
  it("reports what the check said, bucketed by case, on a passing run", async () => {
    await writeRuntimeRule();

    const { stdout, exitCode } = await testRuntime("--json");
    const report = JSON.parse(stdout) as Report;

    expect(exitCode).toBe(0);
    expect(report.rules[0]?.ok).toBe(true);
    const failFindings = findingsOf(report, "fail");
    expect(failFindings).toHaveLength(1);
    expect(failFindings[0]?.message).toBe(RUNTIME_MESSAGE);
    expect(failFindings[0]?.severity).toBe("warning");
    expect(failFindings[0]?.file).toContain("sample.ts");
    expect(findingsOf(report, "pass")).toHaveLength(0);
  });

  it("tags a wrongly-fired pass case as the pass bucket", async () => {
    await writeRuntimeRule(FLAGS_EVERY_MATCH);

    const { stdout, exitCode } = await testRuntime("--json");
    const report = JSON.parse(stdout) as Report;

    expect(exitCode).toBe(1);
    expect(findingsOf(report, "pass")).toHaveLength(1);
    expect(findingsOf(report, "fail")).toHaveLength(1);
  });

  it("prints the pass-bucket finding under a failing rule", async () => {
    await writeRuntimeRule(FLAGS_EVERY_MATCH);

    const { stdout } = await testRuntime();

    expect(stdout).toContain(`✗ runtime/${RUNTIME_RULE}`);
    expect(stdout).toContain("pass fixture findings:");
    expect(stdout).toContain(RUNTIME_MESSAGE);
  });

  it("prints one line and no findings when the rule passed", async () => {
    await writeRuntimeRule();

    const { stdout } = await testRuntime();

    expect(stdout).toContain(`✓ runtime/${RUNTIME_RULE}`);
    expect(stdout).not.toContain("fixture findings");
  });

  it("carries an empty array, not an absent key, on a refused run", async () => {
    // Without the flag nothing executes, so there is nothing to report — and
    // that is the case a consumer must not have to tell apart from "this
    // command does not report findings".
    await writeRuntimeRule();

    const { stdout } = await runCli([
      "test",
      `.taskless/rules/runtime/${RUNTIME_RULE}`,
      "-d",
      cwd,
      "--json",
    ]);
    const report = JSON.parse(stdout) as Report;

    expect(report.rules[0]?.refused).toBeDefined();
    expect(report.rules[0]?.findings).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Always present                                                              */
/* -------------------------------------------------------------------------- */

async function writeSgRule() {
  const directory = join(cwd, ".taskless", "rules", "sg", "no-eval-sg");
  await mkdir(join(directory, ".tests"), { recursive: true });
  await writeFile(
    join(directory, "no-eval-sg.yml"),
    "id: no-eval-sg\nlanguage: TypeScript\nseverity: error\n" +
      "message: no eval\nrule:\n  pattern: eval($ARG)\n"
  );
  await writeFile(
    join(directory, ".tests", "no-eval-sg-test.yml"),
    "id: no-eval-sg\nvalid:\n  - const a = 1;\ninvalid:\n  - eval(x);\n"
  );
}

describe("the findings array is present on every rule result", () => {
  it("is empty rather than absent for an ast-grep rule", async () => {
    // `sg test` reports a count and nothing else, and its fixtures are inline
    // YAML scalars rather than files. Empty is the true answer here, and it has
    // to be stated rather than left to an absent key.
    await writeSgRule();

    const { stdout, exitCode } = await runCli([
      "test",
      ".taskless/rules/sg/no-eval-sg",
      "-d",
      cwd,
      "--json",
    ]);
    const report = JSON.parse(stdout) as Report;

    expect(exitCode).toBe(0);
    expect(report.rules[0]?.ok).toBe(true);
    expect(report.rules[0]?.findings).toEqual([]);
  });

  it("is empty rather than absent for verify, which runs no fixtures", async () => {
    await writeSgRule();

    const { stdout } = await runCli([
      "verify",
      ".taskless/rules/sg/no-eval-sg",
      "-d",
      cwd,
      "--json",
    ]);
    const report = JSON.parse(stdout) as Report;

    expect(report.rules[0]?.findings).toEqual([]);
  });

  it("is empty rather than absent when verification failed before fixtures ran", async () => {
    // No `.vale.ini`, so `verify` fails and `test` never reaches the fixtures.
    const directory = join(cwd, ".taskless", "rules", "vale", VALE_RULE);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${VALE_RULE}.yml`), SUBSTITUTION_STYLE);

    const { stdout, exitCode } = await testVale("--json");
    const report = JSON.parse(stdout) as Report;

    expect(exitCode).toBe(1);
    expect(report.rules[0]?.ok).toBe(false);
    expect(report.rules[0]?.ran).toBe(false);
    expect(report.rules[0]?.findings).toEqual([]);
  });
});
