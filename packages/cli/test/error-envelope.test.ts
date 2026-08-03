import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

interface ErrorEnvelope {
  ok: false;
  code: string;
  message: string;
}

async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const execError = error as {
      stdout: string;
      stderr: string;
      code: number;
    };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: execError.code,
    };
  }
}

function parseEnvelope(stdout: string): ErrorEnvelope {
  // The envelope is the last JSON line in stdout. (Some commands also
  // print progress to stderr, so we ignore that.)
  const lines = stdout.split("\n").filter((l) => l.trim().startsWith("{"));
  expect(lines.length).toBeGreaterThan(0);
  const last = lines.at(-1)!;
  return JSON.parse(last) as ErrorEnvelope;
}

describe("standardized error envelope (--json)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-errors-"));
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({
        version: "2026-03-03",
        orgId: 123,
        repositoryUrl: "https://github.com/test/test",
      })
    );
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  describe("rule create", () => {
    it("emits INVALID_INPUT when --from is missing", async () => {
      const result = await runCli(["rule", "create", "--json", "-d", cwd]);
      expect(result.exitCode).not.toBe(0);
      const env = parseEnvelope(result.stdout);
      expect(env.ok).toBe(false);
      expect(env.code).toBe("INVALID_INPUT");
      expect(env.message).toContain("--from");
    });

    it("emits INVALID_INPUT when --from file does not exist", async () => {
      const result = await runCli([
        "rule",
        "create",
        "--from",
        "nonexistent.json",
        "--json",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).not.toBe(0);
      const env = parseEnvelope(result.stdout);
      expect(env.code).toBe("INVALID_INPUT");
    });

    it("emits INVALID_INPUT when --from file is not valid JSON", async () => {
      const badFile = join(cwd, "bad.json");
      await writeFile(badFile, "not json at all");
      const result = await runCli([
        "rule",
        "create",
        "--from",
        badFile,
        "--json",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).not.toBe(0);
      const env = parseEnvelope(result.stdout);
      expect(env.code).toBe("INVALID_INPUT");
    });

    it("emits INVALID_INPUT when --from file is missing the prompt field", async () => {
      const file = join(cwd, "no-prompt.json");
      await writeFile(file, JSON.stringify({ language: "typescript" }));
      const result = await runCli([
        "rule",
        "create",
        "--from",
        file,
        "--json",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).not.toBe(0);
      const env = parseEnvelope(result.stdout);
      expect(env.code).toBe("INVALID_INPUT");
    });
  });

  describe("rule improve", () => {
    it("emits INVALID_INPUT when --from is missing", async () => {
      const result = await runCli(["rule", "improve", "--json", "-d", cwd]);
      expect(result.exitCode).not.toBe(0);
      const env = parseEnvelope(result.stdout);
      expect(env.code).toBe("INVALID_INPUT");
    });
  });

  describe("rule meta", () => {
    it("emits RULE_NOT_FOUND when metadata sidecar is missing", async () => {
      const result = await runCli([
        "rule",
        "meta",
        "nonexistent-rule",
        "--json",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).not.toBe(0);
      const env = parseEnvelope(result.stdout);
      expect(env.code).toBe("RULE_NOT_FOUND");
      expect(env.message).toContain("nonexistent-rule");
    });
  });

  describe("rule verify", () => {
    it("emits INVALID_INPUT when no rule ID is provided", async () => {
      const result = await runCli(["rule", "verify", "--json", "-d", cwd]);
      expect(result.exitCode).not.toBe(0);
      const env = parseEnvelope(result.stdout);
      expect(env.code).toBe("INVALID_INPUT");
      expect(env.message).toContain("Rule ID is required");
    });
  });

  describe("rule delete", () => {
    it("emits RULE_NOT_FOUND when the rule file does not exist", async () => {
      const result = await runCli([
        "rule",
        "delete",
        "nonexistent-rule",
        "--json",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).not.toBe(0);
      const env = parseEnvelope(result.stdout);
      expect(env.code).toBe("RULE_NOT_FOUND");
      expect(env.message).toContain("nonexistent-rule");
    });

    it("is silent on stdout when a real rule is deleted in --json mode", async () => {
      const rulesDirectory = join(cwd, ".taskless", "sg", "rules");
      await mkdir(rulesDirectory, { recursive: true });
      await writeFile(
        join(rulesDirectory, "doomed.yml"),
        "id: doomed\nlanguage: typescript\nseverity: error\nmessage: ''\nrule: { pattern: 'eval($X)' }\n"
      );
      const result = await runCli([
        "rule",
        "delete",
        "doomed",
        "--json",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("");
    });
  });

  describe("auth login", () => {
    it("emits INVALID_INPUT when --anonymous is set", async () => {
      const result = await runCli([
        "auth",
        "login",
        "--anonymous",
        "--json",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).not.toBe(0);
      const env = parseEnvelope(result.stdout);
      expect(env.code).toBe("INVALID_INPUT");
      expect(env.message).toContain("anonymous");
    });
  });

  describe("auth logout", () => {
    it("is silent on stdout in --json mode and exits 0", async () => {
      const result = await runCli(["auth", "logout", "--json", "-d", cwd]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("");
    });
  });

  describe("envelope shape", () => {
    it("envelope has exactly the documented fields", async () => {
      const result = await runCli(["rule", "create", "--json", "-d", cwd]);
      const env = parseEnvelope(result.stdout);
      expect(Object.keys(env).toSorted()).toEqual(["code", "message", "ok"]);
      expect(env.ok).toBe(false);
      expect(typeof env.code).toBe("string");
      expect(typeof env.message).toBe("string");
    });
  });
});
