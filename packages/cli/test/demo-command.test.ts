import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEMO_RULES, demoRuleFor } from "../src/rules/demo/rule";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

/**
 * The demonstration rules, end to end over the built CLI.
 *
 * Over the BUILT CLI on purpose. These reach a user as bytes embedded in the
 * bundle, and several of their files live under `.tests/` or are named `.env`
 * or `.vale.ini` — dot-paths that glob helpers skip by default. A unit test
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

interface Verdict {
  ruleId: string;
  ok: boolean;
  ran: boolean;
  errors: string[];
}

/** Every rule's verdict from one `taskless test --json` run. */
async function verdicts(extra: string[] = []): Promise<Verdict[]> {
  const { stdout } = await run(["test", "--json", ...extra, "-d", project]);
  return (JSON.parse(stdout) as { rules: Verdict[] }).rules;
}

async function verdictFor(
  ruleId: string,
  extra: string[] = []
): Promise<Verdict> {
  const all = await verdicts(extra);
  const found = all.find((rule) => rule.ruleId === ruleId);
  if (found === undefined) throw new Error(`no report for ${ruleId}`);
  return found;
}

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "tskl-demo-"));
  await run(["init", "-d", project]);
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

describe.each(DEMO_RULES.map((rule) => [rule.engine, rule.ruleId] as const))(
  "taskless demo %s",
  (engine, ruleId) => {
    it("writes a rule that verifies", async () => {
      const written = await run(["demo", engine, "-d", project]);
      expect(written.exitCode).toBe(0);

      const verified = await run(["verify", "-d", project]);
      expect(verified.exitCode).toBe(0);
      expect(verified.stdout).toContain(`${engine}/${ruleId}`);
    });

    it("writes every file verbatim, dot-paths included", async () => {
      await run(["demo", engine, "-d", project]);
      const rule = demoRuleFor(engine);
      expect(rule).toBeDefined();

      for (const file of rule?.files ?? []) {
        const onDisk = await readFile(
          join(project, ".taskless/rules", engine, ruleId, file.path),
          "utf8"
        );
        expect(onDisk, `${file.path} was not written verbatim`).toBe(
          file.content
        );
      }
    });

    it("refuses to overwrite a rule that is already there", async () => {
      await run(["demo", engine, "-d", project]);

      const rule = demoRuleFor(engine);
      const first = rule?.files[0]?.path ?? "";
      const target = join(project, ".taskless/rules", engine, ruleId, first);
      await writeFile(target, "edited by hand\n");

      const second = await run(["demo", engine, "-d", project]);
      expect(second.exitCode).toBe(1);
      expect(second.stderr).toContain("already exists");

      // The refusal has to be a refusal, not a message before a write.
      expect(await readFile(target, "utf8")).toBe("edited by hand\n");
    });

    it("can be removed, leaving nothing a later check reports", async () => {
      await run(["demo", engine, "-d", project]);
      const deleted = await run(["rule", "delete", ruleId, "-d", project]);
      expect(deleted.exitCode).toBe(0);

      const { stdout, stderr } = await run(["check", "-d", project]);
      expect(stdout + stderr).not.toContain(ruleId);
    });
  }
);

describe("the three samples together", () => {
  it("all pass their own fixtures in one project", async () => {
    for (const rule of DEMO_RULES) {
      await run(["demo", rule.engine, "-d", project]);
    }

    const all = await verdicts(["--dangerously-run-scripts"]);
    expect(all).toHaveLength(DEMO_RULES.length);
    for (const verdict of all) {
      // `ran` matters as much as `ok`: a rule reporting a pass for fixtures
      // that never executed is the defect these runners exist to stop
      // reporting.
      expect(
        verdict.ok,
        `${verdict.ruleId}: ${verdict.errors.join("; ")}`
      ).toBe(true);
      expect(verdict.ran, `${verdict.ruleId} never ran`).toBe(true);
    }
  });

  it("covers one engine each, which is the point of shipping three", () => {
    expect([...new Set(DEMO_RULES.map((rule) => rule.engine))]).toHaveLength(
      DEMO_RULES.length
    );
  });
});

describe("the runtime sample does not weaken the execution gate", () => {
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
    expect(stderr).toContain("env-keys-declared");
    expect(stderr).toContain("runtime rules were not verified and did not run");
  });

  it("does not execute its fixtures without the documented flag", async () => {
    const verdict = await verdictFor("env-keys-declared");
    expect(verdict.ran).toBe(false);
  });
});

/** A path inside one written rule's `.tests/`. */
function fixture(
  root: string,
  engine: string,
  ruleId: string,
  ...parts: string[]
): string {
  return join(root, ".taskless/rules", engine, ruleId, ".tests", ...parts);
}

describe("the samples' fixtures are load-bearing", () => {
  // Each mutation breaks one half of one claim, and must break exactly that
  // rule. Without these a fixture pair could rot into something that passes
  // because it asserts nothing.

  it("sg fails when its valid case starts matching", async () => {
    await run(["demo", "sg", "-d", project]);
    await writeFile(
      fixture(project, "sg", "no-eval-call", "no-eval-call-test.yml"),
      "id: no-eval-call\nvalid:\n  - const r = eval(p);\ninvalid:\n  - const r = eval(p);\n"
    );
    const verdict = await verdictFor("no-eval-call");
    expect(verdict.ok).toBe(false);
  });

  it("vale fails when its pass fixture starts firing", async () => {
    await run(["demo", "vale", "-d", project]);
    await writeFile(
      fixture(project, "vale", "prefer-use-over-utilize", "pass", "README.md"),
      "# Setup\n\nUtilize the installer.\n"
    );
    const verdict = await verdictFor("prefer-use-over-utilize");
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("\n")).toContain("pass fixture wrongly fired");
  });

  it("vale fails when its fail fixture stops firing", async () => {
    await run(["demo", "vale", "-d", project]);
    await writeFile(
      fixture(project, "vale", "prefer-use-over-utilize", "fail", "README.md"),
      "# Setup\n\nUse the installer.\n"
    );
    const verdict = await verdictFor("prefer-use-over-utilize");
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("\n")).toContain("fail fixture did not fire");
  });

  it("runtime fails when its fail case stops firing", async () => {
    await run(["demo", "runtime", "-d", project]);
    await writeFile(
      fixture(
        project,
        "runtime",
        "env-keys-declared",
        "fail",
        "undeclared",
        ".env"
      ),
      "API_URL=https://api.example.com\nAPI_KEY=declared-now\n"
    );
    const verdict = await verdictFor("env-keys-declared", [
      "--dangerously-run-scripts",
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("\n")).toContain("fail fixture did not fire");
  });

  it("runtime fails when its pass case starts firing", async () => {
    await run(["demo", "runtime", "-d", project]);
    await writeFile(
      fixture(
        project,
        "runtime",
        "env-keys-declared",
        "pass",
        "declared",
        ".env"
      ),
      "# nothing declared\n"
    );
    const verdict = await verdictFor("env-keys-declared", [
      "--dangerously-run-scripts",
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("\n")).toContain("pass fixture wrongly fired");
  });

  it("runtime fails when its pass case no longer matches the captures", async () => {
    // The runtime-specific one, and the reason an `sg` reading of that tier is
    // wrong: a clean case must still CONTAIN the construct, or the captures do
    // not fire and the check never gets to judge it.
    await run(["demo", "runtime", "-d", project]);
    await writeFile(
      fixture(
        project,
        "runtime",
        "env-keys-declared",
        "pass",
        "declared",
        "src",
        "config.ts"
      ),
      "export const apiUrl = config.apiUrl;\n"
    );
    const verdict = await verdictFor("env-keys-declared", [
      "--dangerously-run-scripts",
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join("\n")).toContain(
      "matched no captures, so check.ts never ran"
    );
  });
});
