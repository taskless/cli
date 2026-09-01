import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateFixture } from "./support/current-project";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

async function runCli(
  args: string[],
  env?: Record<string, string>,
  spawnCwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await migrateFixture(args);

  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args], {
      env: { ...process.env, ...env },
      ...(spawnCwd ? { cwd: spawnCwd } : {}),
    });
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
      expect(result.stderr).toContain(
        "taskless agent improve-rule --anonymous"
      );
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

/**
 * The half of #179 that is a guarantee rather than a change.
 *
 * Remote generation needs a GitHub `origin`; local authoring does not, and
 * never did. `rule create --anonymous` returns before identity is resolved,
 * and `verify` and `test` never resolve it at all. That is easy to regress by
 * hoisting an identity call, and the regression would be invisible to anyone
 * developing inside a GitHub checkout, so it is pinned here across all three
 * no-remote populations.
 */
describe("local authoring needs no GitHub remote", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-noremote-"));
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

  const populations: { name: string; setUp: () => Promise<void> }[] = [
    {
      name: "not a git repository",
      setUp: async () => {
        // The temp directory is already not a repository.
      },
    },
    {
      name: "a git repository with no origin",
      setUp: async () => {
        await execFileAsync("git", ["init"], { cwd });
      },
    },
    {
      name: "an origin that is not GitHub",
      setUp: async () => {
        await execFileAsync("git", ["init"], { cwd });
        await execFileAsync(
          "git",
          ["remote", "add", "origin", "https://gitlab.com/acme/widgets.git"],
          { cwd }
        );
      },
    },
  ];

  // A token is deliberately present. Without one the commands would decline
  // for an unrelated reason and the test would pass without proving anything.
  const withToken = { TASKLESS_TOKEN: "test-token-not-a-real-credential" };

  for (const population of populations) {
    describe(population.name, () => {
      beforeEach(async () => {
        await population.setUp();
      });

      it("rule create --anonymous does not hit a GitHub precondition", async () => {
        const from = join(cwd, "create.json");
        await writeFile(from, JSON.stringify({ prompt: "no eval" }));
        const result = await runCli(
          [
            "rule",
            "create",
            "--from",
            from,
            "--anonymous",
            "--json",
            "-d",
            cwd,
          ],
          withToken
        );
        expect(result.stdout + result.stderr).not.toMatch(
          /NOT_A_GIT_REPOSITORY|NO_ORIGIN_REMOTE|UNSUPPORTED_REMOTE_HOST|NO_GITHUB_REMOTE/
        );
      });

      it("verify runs to completion", async () => {
        const result = await runCli(["verify", "-d", cwd], withToken);
        expect(result.stdout + result.stderr).not.toMatch(
          /NOT_A_GIT_REPOSITORY|NO_ORIGIN_REMOTE|UNSUPPORTED_REMOTE_HOST|NO_GITHUB_REMOTE/
        );
      });

      it("check runs to completion", async () => {
        const result = await runCli(["check", "-d", cwd], withToken);
        expect(result.exitCode).toBe(0);
        expect(result.stdout + result.stderr).not.toMatch(
          /NOT_A_GIT_REPOSITORY|NO_ORIGIN_REMOTE|UNSUPPORTED_REMOTE_HOST|NO_GITHUB_REMOTE/
        );
      });
    });
  }
});

/**
 * `route` reads capability state from `taskless info --json` before it
 * classifies, so these two fields are what tells it whether remote generation
 * is a destination at all. They ride on a call it already makes; a second
 * lookup could disagree with the one the CLI enforces.
 */
describe("info reports the repository context", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-infoctx-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function readInfo(): Promise<{
    repositoryUrl: string | null;
    ghOwner: string;
  }> {
    const result = await runCli(["info", "--json", "-d", cwd]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      repositoryUrl: string | null;
      ghOwner: string;
    };
    return parsed;
  }

  it("reports the canonical URL and owner for a GitHub origin", async () => {
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync(
      "git",
      ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
      { cwd }
    );
    const info = await readInfo();
    expect(info.repositoryUrl).toBe("https://github.com/acme/widgets");
    expect(info.ghOwner).toBe("acme");
  });

  it("reports null and [unknown] when the directory is not a git repository", async () => {
    const info = await readInfo();
    expect(info.repositoryUrl).toBeNull();
    expect(info.ghOwner).toBe("[unknown]");
  });

  it("reports null and [unknown] when there is no origin remote", async () => {
    await execFileAsync("git", ["init"], { cwd });
    const info = await readInfo();
    expect(info.repositoryUrl).toBeNull();
    expect(info.ghOwner).toBe("[unknown]");
  });

  it("reports null and [unknown] for a non-GitHub origin", async () => {
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync(
      "git",
      ["remote", "add", "origin", "https://gitlab.com/acme/widgets.git"],
      { cwd }
    );
    const info = await readInfo();
    expect(info.repositoryUrl).toBeNull();
    expect(info.ghOwner).toBe("[unknown]");
  });

  it("resolves the context even under --anonymous", async () => {
    // `--anonymous` suppresses the API/auth probe. The repository context is
    // local, so it is unaffected: capability state is not auth state.
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync(
      "git",
      ["remote", "add", "origin", "https://github.com/acme/widgets.git"],
      { cwd }
    );
    const result = await runCli(["info", "--anonymous", "--json", "-d", cwd]);
    expect(result.exitCode).toBe(0);
    const info = JSON.parse(result.stdout) as {
      loggedIn: boolean;
      ghOwner: string;
    };
    expect(info.loggedIn).toBe(false);
    expect(info.ghOwner).toBe("acme");
  });
});

/**
 * The repository context deliberately went on `info`, not on `auth`.
 *
 * `route` already calls `info --json`, so the fields ride on a call it makes
 * anyway. `auth` status is plain text with no payload, and giving it one
 * would have meant inventing an output format for a command `route` never
 * calls. This pins that decision: a later change that grows a payload here
 * has to delete this test first, and say why.
 */
describe("auth status stays plain text", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-authtext-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("prints the plain-text status and emits no JSON payload", async () => {
    const result = await runCli(["auth"], { TASKLESS_TOKEN: "" }, cwd);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Not logged in.");
    expect(() => {
      JSON.parse(result.stdout);
    }).toThrow();
    expect(result.stdout).not.toContain("repositoryUrl");
    expect(result.stdout).not.toContain("ghOwner");
  });
});
