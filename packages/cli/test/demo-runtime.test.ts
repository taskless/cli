import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEMO_RUNTIME_FILES,
  DEMO_RUNTIME_RULE_ID,
} from "../src/rules/demo/rule";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

/**
 * The demonstration rule, end to end over the built CLI.
 *
 * Over the BUILT CLI on purpose. The rule reaches a user as bytes embedded in
 * the bundle, and two of its six files live under `.tests/` while a third is
 * named `.env` — dot-paths that glob helpers skip by default. A unit test
 * importing the module would confirm the imports resolve and say nothing about
 * whether the bundle carries them.
 */

let project: string;

async function run(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: failure.code ?? 1,
    };
  }
}

/** `taskless test --json`'s verdict for the demo rule. */
async function testVerdict(
  extra: string[] = []
): Promise<{ ok: boolean; ran: boolean; errors: string[] }> {
  const { stdout } = await run(["test", "--json", ...extra, "-d", project]);
  const report = JSON.parse(stdout) as {
    rules: { ruleId: string; ok: boolean; ran: boolean; errors: string[] }[];
  };
  const rule = report.rules.find((r) => r.ruleId === DEMO_RUNTIME_RULE_ID);
  if (rule === undefined) {
    throw new Error(`no report for ${DEMO_RUNTIME_RULE_ID} in ${stdout}`);
  }
  return rule;
}

function fixturePath(...parts: string[]): string {
  return join(
    project,
    ".taskless/rules/runtime",
    DEMO_RUNTIME_RULE_ID,
    ".tests",
    ...parts
  );
}

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "tskl-demo-"));
  await run(["init", "-d", project]);
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

describe("taskless demo runtime", () => {
  it("writes a rule that verifies and passes its own fixtures", async () => {
    const written = await run(["demo", "runtime", "-d", project]);
    expect(written.exitCode).toBe(0);

    const verified = await run(["verify", "-d", project]);
    expect(verified.exitCode).toBe(0);
    expect(verified.stdout).toContain(`runtime/${DEMO_RUNTIME_RULE_ID}`);

    // `ran` matters as much as `ok` here: a runtime rule reporting a pass for
    // fixtures that never executed is the exact defect this tier's runner was
    // built to stop reporting.
    const verdict = await testVerdict(["--dangerously-run-scripts"]);
    expect(verdict.ok).toBe(true);
    expect(verdict.ran).toBe(true);
    expect(verdict.errors).toEqual([]);
  });

  it("embeds every file, including the dot-paths a glob would skip", async () => {
    await run(["demo", "runtime", "-d", project]);

    const paths = DEMO_RUNTIME_FILES.map((file) => file.path);
    expect(paths).toContain(".tests/pass/declared/.env");
    expect(paths).toContain(".tests/fail/undeclared/.env");

    for (const file of DEMO_RUNTIME_FILES) {
      const onDisk = await readFile(
        join(
          project,
          ".taskless/rules/runtime",
          DEMO_RUNTIME_RULE_ID,
          file.path
        ),
        "utf8"
      );
      expect(onDisk, `${file.path} was not written verbatim`).toBe(
        file.content
      );
    }
  });

  it("refuses to overwrite a rule that is already there", async () => {
    await run(["demo", "runtime", "-d", project]);

    const target = join(
      project,
      ".taskless/rules/runtime",
      DEMO_RUNTIME_RULE_ID,
      "check.ts"
    );
    await writeFile(target, "// edited by hand\n");

    const second = await run(["demo", "runtime", "-d", project]);
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain("already exists");

    // The refusal has to be a refusal, not a message before a write.
    expect(await readFile(target, "utf8")).toBe("// edited by hand\n");
  });
});

describe("the demo rule does not weaken the execution gate", () => {
  beforeEach(async () => {
    await run(["demo", "runtime", "-d", project]);
  });

  it("is skipped by an unauthenticated check, with the existing reason", async () => {
    const { stdout, stderr, exitCode } = await run(["check", "-d", project]);
    expect(exitCode).toBe(0);
    // The skip is a NOTICE on stderr, not a finding on stdout: `check` found no
    // issues, and reporting a rule it declined to run as an issue would be the
    // opposite of what the gate means.
    expect(stdout).toContain("No issues found.");
    expect(stderr).toContain(DEMO_RUNTIME_RULE_ID);
    expect(stderr).toContain("runtime rules were not verified and did not run");
  });

  it("does not execute its fixtures without the documented flag", async () => {
    const verdict = await testVerdict();
    expect(verdict.ran).toBe(false);
  });
});

describe("the demo rule's fixtures are load-bearing", () => {
  beforeEach(async () => {
    await run(["demo", "runtime", "-d", project]);
  });

  // Each mutation breaks one half of the claim. Without these the fixtures
  // could rot into a pair that passes because it asserts nothing, which is the
  // failure mode this whole tier exists to catch.

  it("fails when the fail case stops firing", async () => {
    await writeFile(
      fixturePath("fail/undeclared/.env"),
      "API_URL=https://api.example.com\nAPI_KEY=declared-now\n"
    );
    const verdict = await testVerdict(["--dangerously-run-scripts"]);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("\n")).toContain("fail fixture did not fire");
  });

  it("fails when the pass case starts firing", async () => {
    await writeFile(fixturePath("pass/declared/.env"), "# nothing declared\n");
    const verdict = await testVerdict(["--dangerously-run-scripts"]);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("\n")).toContain("pass fixture wrongly fired");
  });

  it("fails when the pass case no longer matches the captures", async () => {
    // The runtime-specific one, and the reason an `sg` reading of this rule is
    // wrong: a clean case must still CONTAIN the construct, or the captures do
    // not fire and the check never gets to judge it.
    await writeFile(
      fixturePath("pass/declared/src/config.ts"),
      "export const apiUrl = config.apiUrl;\n"
    );
    const verdict = await testVerdict(["--dangerously-run-scripts"]);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("\n")).toContain(
      "matched no captures, so check.ts never ran"
    );
  });
});

describe("what the demo writes can be removed", () => {
  it("leaves nothing a later check reports", async () => {
    await run(["demo", "runtime", "-d", project]);

    const deleted = await run([
      "rule",
      "delete",
      DEMO_RUNTIME_RULE_ID,
      "-d",
      project,
    ]);
    expect(deleted.exitCode).toBe(0);

    const { stdout, stderr } = await run(["check", "-d", project]);
    expect(stdout + stderr).not.toContain(DEMO_RUNTIME_RULE_ID);
  });
});
