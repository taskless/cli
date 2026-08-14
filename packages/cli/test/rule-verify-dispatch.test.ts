import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

/**
 * Vale ships as a platform binary, so a host without one (an unsupported arch,
 * a blocked install) cannot run these. Skipping is right where the alternative
 * is a suite that fails for a reason unrelated to the code under test.
 */
const withVale = findValeBinary().path === undefined ? describe.skip : describe;

async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const execError = error as { stdout: string; stderr: string; code: number };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: execError.code,
    };
  }
}

const VALE_RULE = `extends: existence
message: "Avoid %s"
level: warning
tokens:
  - simply
`;

const VALE_CONFIG = `StylesPath = .
MinAlertLevel = suggestion

[*.md]
BasedOnStyles =
rules.no-simply = YES
`;

/** Scaffold a project with a Vale rule and both fixture buckets populated. */
async function scaffoldValeRule(cwd: string): Promise<void> {
  const vale = join(cwd, ".taskless", "vale");
  await mkdir(join(vale, "rules"), { recursive: true });
  await mkdir(join(vale, "rule-tests", "no-simply", "pass"), {
    recursive: true,
  });
  await mkdir(join(vale, "rule-tests", "no-simply", "fail"), {
    recursive: true,
  });
  await writeFile(join(vale, "rules", "no-simply.yml"), VALE_RULE);
  await writeFile(join(vale, ".vale.ini"), VALE_CONFIG);
  await writeFile(
    join(vale, "rule-tests", "no-simply", "fail", "bad.md"),
    "You simply do it.\n"
  );
  await writeFile(
    join(vale, "rule-tests", "no-simply", "pass", "ok.md"),
    "You do it.\n"
  );
}

interface ValeVerifyJson {
  engine: string;
  success: boolean;
  ruleId: string;
  fixtures: string;
  missingFailures: string[];
  unexpectedFindings: string[];
}

describe("rule verify dispatches by owning engine", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-verify-dispatch-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  // The id lives under both engines. Verifying one silently would report on a
  // file the caller may not have meant, so this is an error naming both.
  it("refuses an id that exists under two engines", async () => {
    await scaffoldValeRule(cwd);
    await mkdir(join(cwd, ".taskless", "sg", "rules"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "sg", "rules", "no-simply.yml"),
      "id: no-simply\nlanguage: TypeScript\nseverity: error\nmessage: x\nrule:\n  pattern: eval($A)\n"
    );

    const result = await runCli(["rule", "verify", "no-simply", "-d", cwd]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("more than one engine");
    expect(result.stderr).toContain(".taskless/sg/rules/no-simply.yml");
    expect(result.stderr).toContain(".taskless/vale/rules/no-simply.yml");
  });

  it("tags the ast-grep result with its engine", async () => {
    await mkdir(join(cwd, ".taskless", "sg", "rules"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "sg", "rules", "no-eval.yml"),
      "id: no-eval\nlanguage: TypeScript\nseverity: error\nmessage: no eval\nrule:\n  pattern: eval($$$A)\n"
    );

    const result = await runCli([
      "rule",
      "verify",
      "no-eval",
      "-d",
      cwd,
      "--json",
    ]);
    const parsed = JSON.parse(result.stdout) as { engine: string };
    expect(parsed.engine).toBe("sg");
  });
});

withVale("rule verify enforces the Vale fixture layout", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-vale-verify-"));
    await scaffoldValeRule(cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("passes a rule that fires on fail/ and stays quiet on pass/", async () => {
    const result = await runCli([
      "rule",
      "verify",
      "no-simply",
      "-d",
      cwd,
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as ValeVerifyJson;
    expect(parsed.engine).toBe("vale");
    expect(parsed.success).toBe(true);
    expect(parsed.fixtures).toBe("both");
  });

  // A one-sided rule is the failure this enforcement exists for. With only
  // `fail/` fixtures the rule was never shown not to over-fire, and reporting
  // that as a pass is how an unverified rule ships looking verified.
  it("fails a rule with only fail/ fixtures", async () => {
    await rm(join(cwd, ".taskless", "vale", "rule-tests", "no-simply", "pass"), {
      recursive: true,
      force: true,
    });

    const result = await runCli([
      "rule",
      "verify",
      "no-simply",
      "-d",
      cwd,
      "--json",
    ]);
    expect(result.exitCode).not.toBe(0);
    const parsed = JSON.parse(result.stdout) as ValeVerifyJson;
    expect(parsed.success).toBe(false);
    expect(parsed.fixtures).toBe("fail-only");
  });

  it("fails a rule with only pass/ fixtures", async () => {
    await rm(join(cwd, ".taskless", "vale", "rule-tests", "no-simply", "fail"), {
      recursive: true,
      force: true,
    });

    const result = await runCli([
      "rule",
      "verify",
      "no-simply",
      "-d",
      cwd,
      "--json",
    ]);
    expect(result.exitCode).not.toBe(0);
    const parsed = JSON.parse(result.stdout) as ValeVerifyJson;
    expect(parsed.success).toBe(false);
    expect(parsed.fixtures).toBe("pass-only");
  });

  // Vale lints the rule's whole tree, so a nested document is linted but never
  // checked against a bucket. Rejecting names the path at the moment someone
  // creates it, rather than letting half a rule's fixtures go unverified.
  it("rejects a nested fixture directory by name", async () => {
    const nested = join(
      cwd,
      ".taskless",
      "vale",
      "rule-tests",
      "no-simply",
      "pass",
      "nested"
    );
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "x.md"), "fine\n");

    const result = await runCli([
      "rule",
      "verify",
      "no-simply",
      "-d",
      cwd,
      "--json",
    ]);
    expect(result.exitCode).not.toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      code: string;
      message: string;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.message).toContain("flat");
    expect(parsed.message).toContain("nested");
  });

  it("reports which fail/ fixture did not fire", async () => {
    await writeFile(
      join(cwd, ".taskless", "vale", "rule-tests", "no-simply", "fail", "b.md"),
      "This text does not contain the token.\n"
    );

    const result = await runCli([
      "rule",
      "verify",
      "no-simply",
      "-d",
      cwd,
      "--json",
    ]);
    expect(result.exitCode).not.toBe(0);
    const parsed = JSON.parse(result.stdout) as ValeVerifyJson;
    expect(parsed.success).toBe(false);
    expect(parsed.missingFailures).toHaveLength(1);
    expect(parsed.missingFailures[0]).toContain("b.md");
  });

  it("reports which pass/ fixture wrongly fired", async () => {
    await writeFile(
      join(cwd, ".taskless", "vale", "rule-tests", "no-simply", "pass", "b.md"),
      "You simply cannot.\n"
    );

    const result = await runCli([
      "rule",
      "verify",
      "no-simply",
      "-d",
      cwd,
      "--json",
    ]);
    expect(result.exitCode).not.toBe(0);
    const parsed = JSON.parse(result.stdout) as ValeVerifyJson;
    expect(parsed.success).toBe(false);
    expect(parsed.unexpectedFindings).toHaveLength(1);
    expect(parsed.unexpectedFindings[0]).toContain("b.md");
  });
});
