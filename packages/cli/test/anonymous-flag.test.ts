import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

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

describe("--anonymous flag (per-command behavior matrix)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-anon-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  describe("info --anonymous", () => {
    it("skips the API/auth probe and reports loggedIn: false", async () => {
      const result = await runCli(["info", "--anonymous", "--json", "-d", cwd]);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        loggedIn: boolean;
        auth?: unknown;
      };
      // Even if a token were present, --anonymous suppresses the lookup.
      expect(parsed.loggedIn).toBe(false);
      expect(parsed.auth).toBeUndefined();
    });
  });

  describe("auth login --anonymous", () => {
    it("rejects with exit 1 and 'auth commands cannot be anonymous'", async () => {
      const result = await runCli(["auth", "login", "--anonymous", "-d", cwd]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("auth commands cannot be anonymous");
    });
  });

  describe("auth logout --anonymous", () => {
    it("accepts the flag as no-op (same behavior as plain logout)", async () => {
      const result = await runCli(["auth", "logout", "--anonymous", "-d", cwd]);
      expect(result.exitCode).toBe(0);
      // Either "Logged out." or "Not logged in." depending on initial state;
      // both are success.
      expect(result.stdout).toMatch(/Logged out|Not logged in/);
    });
  });

  describe("check --anonymous", () => {
    it("accepts the flag as no-op (same behavior as plain check)", async () => {
      // No .taskless/ directory → friendly "no rules" message, exit 0
      const result = await runCli(["check", "--anonymous", "-d", cwd]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No rules configured");
    });
  });

  describe("rule create --anonymous", () => {
    it("exits with a pointer to the local-only recipe (does not run generation)", async () => {
      // No --from needed; the --anonymous branch short-circuits before
      // file validation.
      const result = await runCli(["rule", "create", "--anonymous", "-d", cwd]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("taskless agent create-sg-rule");
    });

    it("with --json, emits the standardized envelope", async () => {
      const result = await runCli([
        "rule",
        "create",
        "--anonymous",
        "--json",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).not.toBe(0);
      const parsed = JSON.parse(result.stdout) as { ok: boolean; code: string };
      expect(parsed.ok).toBe(false);
      expect(parsed.code).toBe("INVALID_INPUT");
    });
  });

  describe("rule improve --anonymous", () => {
    it("exits with a pointer to the local-only recipe", async () => {
      const result = await runCli([
        "rule",
        "improve",
        "--anonymous",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("taskless agent improve-rule --anonymous");
    });
  });

  describe("rule delete --anonymous", () => {
    it("accepts the flag as no-op (same behavior as plain delete)", async () => {
      // Rule doesn't exist → exit 1 with "not found", same as without --anonymous
      const result = await runCli([
        "rule",
        "delete",
        "nonexistent",
        "--anonymous",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not found");
    });
  });

  describe("rule verify --anonymous", () => {
    it("accepts the flag as no-op", async () => {
      // No rule ID → INVALID_INPUT regardless of --anonymous
      const result = await runCli([
        "rule",
        "verify",
        "--anonymous",
        "--json",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).not.toBe(0);
      const parsed = JSON.parse(result.stdout) as { code: string };
      expect(parsed.code).toBe("INVALID_INPUT");
    });
  });

  describe("rule meta --anonymous", () => {
    it("accepts the flag as no-op", async () => {
      // Rule doesn't exist → RULE_NOT_FOUND regardless of --anonymous
      await mkdir(join(cwd, ".taskless"), { recursive: true });
      await writeFile(
        join(cwd, ".taskless", "taskless.json"),
        JSON.stringify({ version: 2, install: {} })
      );
      const result = await runCli([
        "rule",
        "meta",
        "nonexistent",
        "--anonymous",
        "--json",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).not.toBe(0);
      const parsed = JSON.parse(result.stdout) as { code: string };
      expect(parsed.code).toBe("RULE_NOT_FOUND");
    });
  });

  describe("init --anonymous", () => {
    it("accepts the flag as no-op", async () => {
      const result = await runCli([
        "init",
        "--no-interactive",
        "--anonymous",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).toBe(0);
    });
  });
});
