import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `taskless test` against a runtime rule.
 *
 * The defect this file exists for: `test` printed `✓ runtime/<id>` and counted
 * the rule among those tested for a rule whose fixtures never ran. Every
 * assertion here is about the difference between running a rule and saying
 * one ran, so none of them may be relaxed into "does not crash".
 *
 * These spawn the built CLI rather than calling `testOneRule`, because the tick
 * and the summary line are half the defect and only the command prints them.
 */

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

let cwd: string;

async function runCli(args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
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

interface Report {
  ok: boolean;
  rules: {
    engine: string;
    ruleId: string;
    ok: boolean;
    errors: string[];
    ran?: boolean;
    refused?: string;
  }[];
}

/** A capture matching `eval(...)`, which every fixture below is written around. */
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

/**
 * The realistic shape: the capture narrows to `eval(...)`, and the check
 * decides. It reports only where the argument is not a literal, which is the
 * judgement a runtime rule exists to make and an ast-grep pattern cannot.
 *
 * This is what makes a `pass/` case possible at all. A pass case has to MATCH
 * the narrow, or `check.ts` is never invoked and the case proves nothing about
 * the check staying quiet — so a check that flagged every match would have no
 * passing fixture that ran.
 */
const FLAGS_DYNAMIC_EVAL = String.raw`import { readFileSync } from "node:fs";
import { join } from "node:path";

export default async function (root, matches) {
  return matches
    .filter((m) => !readFileSync(join(root, m.file), "utf8").includes('eval("'))
    .map((m) => ({
      file: m.file,
      line: m.line,
      column: m.column,
      message: "eval on a non-literal is not allowed",
      severity: "warning",
    }));
}
`;

/** Reports one finding per match: the indiscriminate rule, which cannot pass. */
const FLAGS_EVERY_MATCH = `export default async function (root, matches) {
  return matches.map((m) => ({
    file: m.file,
    line: m.line,
    column: m.column,
    message: "eval is not allowed",
    severity: "warning",
  }));
}
`;

/** Reaches the check and deliberately reports nothing. */
const FLAGS_NOTHING = `export default async function () {
  return [];
}
`;

/** Reaches the check and dies there, which is not "found nothing". */
const THROWS = `export default async function () {
  throw new Error("check exploded");
}
`;

const RULE = "no-eval";

function ruleDirectory(): string {
  return join(cwd, ".taskless", "rules", "runtime", RULE);
}

/** Write the rule itself: one capture and one `check.ts`, and no fixtures. */
async function writeRule(check: string = FLAGS_DYNAMIC_EVAL): Promise<void> {
  const directory = ruleDirectory();
  await mkdir(join(directory, "captures"), { recursive: true });
  await writeFile(join(directory, "captures", "eval.yml"), EVAL_CAPTURE);
  await writeFile(join(directory, "check.ts"), check);
}

/**
 * A fixture case: a DIRECTORY holding source, which is the `root` the check is
 * given.
 *
 * Two axes, and keeping them apart is the point of D8. `matching` decides
 * whether the NARROW finds anything, which is a property of the fixture;
 * `flagged` decides whether the CHECK reports on what the narrow found, which
 * is a property of the rule. A case can match and not be flagged (the useful
 * `pass/` case), or fail to match at all (a fixture defect in either bucket).
 */
async function writeCase(
  bucket: "pass" | "fail",
  name: string,
  options: { matching?: boolean; flagged?: boolean } = {}
): Promise<string> {
  const matching = options.matching ?? true;
  const flagged = options.flagged ?? bucket === "fail";
  const directory = join(ruleDirectory(), ".tests", bucket, name);
  await mkdir(directory, { recursive: true });
  const source = matching
    ? flagged
      ? "const input = globalThis.userInput;\neval(input);\n"
      : 'eval("1 + 1");\n'
    : "const total = 1 + 1;\n";
  await writeFile(join(directory, "sample.ts"), source);
  return directory;
}

async function testRule(...extra: string[]) {
  return runCli([
    "test",
    `.taskless/rules/runtime/${RULE}`,
    "-d",
    cwd,
    ...extra,
  ]);
}

async function testRuleJson(...extra: string[]): Promise<Report> {
  const { stdout } = await testRule("--json", ...extra);
  return JSON.parse(stdout) as Report;
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "tskl-rt-runner-"));
  await runCli(["init", "--no-interactive", "-d", cwd]);
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

/**
 * 5.1 — the defect itself.
 *
 * With no blessed signature and no escape flag the fixtures cannot run. That is
 * not a failure of the rule, but it is emphatically not a pass, and the two
 * assertions below are the ones that were false before the runner existed.
 */
describe("a runtime rule whose fixtures did not run", () => {
  it("is not reported as passing, and prints no tick", async () => {
    await writeRule();
    await writeCase("fail", "uses-eval");
    await writeCase("pass", "no-eval");

    const { stdout, exitCode } = await testRule();

    expect(stdout).not.toContain(`✓ runtime/${RULE}`);
    // A refusal by policy is not the rule's fault, so it must not fail either.
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("1 rule(s) tested");
  });

  it("says the fixtures did not run, and names the flag that would run them", async () => {
    await writeRule();
    await writeCase("fail", "uses-eval");
    await writeCase("pass", "no-eval");

    const { stdout } = await testRule();

    expect(stdout).toContain("did not run");
    expect(stdout).toContain("--dangerously-run-scripts");
  });

  it("offers the flag as the only route, and never sends the author to auth", async () => {
    // `test` does not reconcile, so authenticating changes nothing here and
    // saying otherwise would send an author to a login that cannot help: a
    // locally authored rule has no signature and never will. The flag is the
    // whole gate, so it has to be the whole message.
    await writeRule();
    await writeCase("fail", "uses-eval");
    await writeCase("pass", "no-eval");

    const { stdout } = await testRule();

    expect(stdout).toContain("--dangerously-run-scripts");
    expect(stdout).not.toContain("auth login");
    expect(stdout).not.toContain("not authenticated");
    expect(stdout).not.toContain("server verification");
  });

  it("reports ran: false in --json, and does not report ok: true", async () => {
    await writeRule();
    await writeCase("fail", "uses-eval");
    await writeCase("pass", "no-eval");

    const report = await testRuleJson();
    const rule = report.rules[0];

    expect(rule?.engine).toBe("runtime");
    expect(rule?.ran).toBe(false);
    expect(rule?.ok).not.toBe(true);
    // The envelope still succeeds: nothing here is a defect in the rule.
    expect(report.ok).toBe(true);
  });
});

/** 3.3 / 3.4 — the gate is the gate, and nothing about a fixture softens it. */
describe("the execution gate", () => {
  it("executes nothing for an unblessed rule", async () => {
    // A check that writes a file is the only way to prove non-execution: the
    // absence of findings is what a gated-out run and a clean run share.
    const witness = join(cwd, "witness.txt");
    await writeRule(
      `import { writeFileSync } from "node:fs";
export default async function () {
  writeFileSync(${JSON.stringify(witness)}, "ran");
  return [];
}
`
    );
    await writeCase("fail", "uses-eval");
    await writeCase("pass", "no-eval");

    await testRule();

    await expect(
      import("node:fs/promises").then((fs) => fs.readFile(witness, "utf8"))
    ).rejects.toThrow();
  });

  it("does not exempt a rule for its id", async () => {
    // The demo rule id gets no special treatment; only the flag or a blessing
    // does. Same assertion as above under the name a bypass would have used.
    await writeRule();
    await writeCase("fail", "uses-eval");
    await writeCase("pass", "no-eval");

    const report = await testRuleJson();

    expect(report.rules[0]?.ran).toBe(false);
  });

  it("runs the fixtures under --dangerously-run-scripts, with the warning", async () => {
    await writeRule();
    await writeCase("fail", "uses-eval");
    await writeCase("pass", "no-eval");

    const { stdout, stderr, exitCode } = await testRule(
      "--dangerously-run-scripts"
    );

    expect(stderr).toContain("--dangerously-run-scripts is executing runtime");
    expect(stdout).toContain(`✓ runtime/${RULE}`);
    expect(exitCode).toBe(0);
  });
});

/** 5.2 / 5.3 — the two directions a fixture can break. */
describe("fixture directions", () => {
  it("fails a fail/ case that produced no findings", async () => {
    await writeRule(FLAGS_NOTHING);
    await writeCase("fail", "uses-eval");
    await writeCase("pass", "no-eval");

    const report = await testRuleJson("--dangerously-run-scripts");
    const rule = report.rules[0];

    expect(rule?.ran).toBe(true);
    expect(rule?.ok).toBe(false);
    expect(rule?.errors.join("\n")).toContain("fail/uses-eval");
    expect(report.ok).toBe(false);
  });

  it("fails a pass/ case that produced findings", async () => {
    // The indiscriminate rule: it flags every match, so the `pass/` case
    // reaches the check and is reported anyway. That is the rule the `pass/`
    // bucket exists to catch, and nothing but running it can.
    await writeRule(FLAGS_EVERY_MATCH);
    await writeCase("fail", "uses-eval");
    await writeCase("pass", "literal-eval");

    const report = await testRuleJson("--dangerously-run-scripts");
    const rule = report.rules[0];

    expect(rule?.ran).toBe(true);
    expect(rule?.ok).toBe(false);
    expect(rule?.errors.join("\n")).toContain("pass/literal-eval");
  });
});

/**
 * 2.4 / 2.5 — a case that never reached the check.
 *
 * The `pass/` half is the quiet one and is the reason this is not just a
 * kinder message on the `fail/` side: such a case reads as a clean pass while
 * proving only that the narrow did not match.
 */
describe("a case that never reaches the check", () => {
  it("is a fixture defect in fail/, not a rule that stopped firing", async () => {
    await writeRule();
    await writeCase("fail", "matches-nothing", { matching: false });
    await writeCase("pass", "no-eval");

    const report = await testRuleJson("--dangerously-run-scripts");
    const errors = report.rules[0]?.errors.join("\n") ?? "";

    expect(report.rules[0]?.ok).toBe(false);
    expect(errors).toContain("fail/matches-nothing");
    expect(errors).toContain("check.ts never ran");
    // The wrong message is the one that sends the author to the check.
    expect(errors).not.toContain("fail fixture did not fire");
  });

  it("is a fixture defect in pass/ too", async () => {
    await writeRule();
    await writeCase("fail", "uses-eval");
    await writeCase("pass", "matches-nothing", { matching: false });

    const report = await testRuleJson("--dangerously-run-scripts");
    const errors = report.rules[0]?.errors.join("\n") ?? "";

    expect(report.rules[0]?.ok).toBe(false);
    expect(errors).toContain("pass/matches-nothing");
    expect(errors).toContain("check.ts never ran");
  });
});

/** 2.3 — a check that throws is not a check that found nothing. */
describe("a check that throws", () => {
  it("is reported as the check failing, not as an empty result", async () => {
    await writeRule(THROWS);
    await writeCase("fail", "uses-eval");
    await writeCase("pass", "no-eval");

    const report = await testRuleJson("--dangerously-run-scripts");
    const errors = report.rules[0]?.errors.join("\n") ?? "";

    expect(report.rules[0]?.ok).toBe(false);
    expect(errors).toContain("check failed on fail/uses-eval");
    expect(errors).toContain("check exploded");
    // A throw in `fail/` must not be scored as the case firing correctly, and
    // a throw in `pass/` must not be scored as the case staying quiet.
    expect(errors).toContain("check failed on pass/no-eval");
  });
});

/** 5.4 — coverage, where only `both` reaches a pass. */
describe("fixture coverage", () => {
  it("passes with both buckets populated", async () => {
    await writeRule();
    await writeCase("fail", "uses-eval");
    await writeCase("pass", "no-eval");

    const report = await testRuleJson("--dangerously-run-scripts");

    expect(report.rules[0]?.ok).toBe(true);
    expect(report.rules[0]?.ran).toBe(true);
  });

  it("fails with only fail/ cases", async () => {
    await writeRule();
    await writeCase("fail", "uses-eval");

    const report = await testRuleJson("--dangerously-run-scripts");

    expect(report.rules[0]?.ok).toBe(false);
    expect(report.rules[0]?.errors.join("\n")).toContain("only fail/");
  });

  it("fails with only pass/ cases", async () => {
    await writeRule();
    await writeCase("pass", "no-eval");

    const report = await testRuleJson("--dangerously-run-scripts");

    expect(report.rules[0]?.ok).toBe(false);
    expect(report.rules[0]?.errors.join("\n")).toContain("only pass/");
  });

  it("fails with no fixtures at all", async () => {
    await writeRule();

    const report = await testRuleJson("--dangerously-run-scripts");

    expect(report.rules[0]?.ok).toBe(false);
    expect(report.rules[0]?.errors.join("\n")).toContain("has no fixtures");
  });
});

/** 5.5 — a bucket that cannot be read is not a bucket holding nothing. */
describe("an unreadable bucket", () => {
  it("is an error rather than an empty bucket", async () => {
    await writeRule();
    await writeCase("fail", "uses-eval");
    const passBucket = join(ruleDirectory(), ".tests", "pass");
    await mkdir(passBucket, { recursive: true });
    await chmod(passBucket, 0o000);

    try {
      const report = await testRuleJson("--dangerously-run-scripts");

      expect(report.rules[0]?.ok).toBe(false);
      // The wrong answer is "only fail/ fixtures": that reads as a rule the
      // author half-wrote, when the pass cases may well be sitting right there.
      expect(report.rules[0]?.errors.join("\n")).not.toContain("only fail/");
    } finally {
      await chmod(passBucket, 0o755);
    }
  });

  it("refuses a loose file in a bucket, naming it", async () => {
    await writeRule();
    await writeCase("fail", "uses-eval");
    const passBucket = join(ruleDirectory(), ".tests", "pass");
    await mkdir(passBucket, { recursive: true });
    await writeFile(join(passBucket, "loose.ts"), "const x = 1;\n");

    const report = await testRuleJson("--dangerously-run-scripts");

    expect(report.rules[0]?.ok).toBe(false);
    expect(report.rules[0]?.errors.join("\n")).toContain("loose.ts");
  });
});
