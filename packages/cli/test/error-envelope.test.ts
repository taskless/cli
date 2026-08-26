import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveOrgSubject } from "../src/auth/org";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

interface ErrorEnvelope {
  ok: false;
  code: string;
  message: string;
}

async function runCli(
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Never inherit an ambient TASKLESS_TOKEN: it decides whether the very first
  // step of `resolveIdentity` fails, so a developer who is logged in would
  // otherwise see different codes than CI.
  const { TASKLESS_TOKEN: _ignored, ...baseEnvironment } = process.env;
  const options = { env: { ...baseEnvironment, ...env } };
  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      [binPath, ...args],
      options
    );
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
      const ruleDirectory = join(cwd, ".taskless", "rules", "sg", "doomed");
      await mkdir(ruleDirectory, { recursive: true });
      await writeFile(
        join(ruleDirectory, "doomed.yml"),
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

/**
 * The four origins a `resolveIdentity` failure can have, and the code each
 * one must produce. These codes are a public interface: an agent reads
 * `code`, never `message`. The point of asserting them here is that
 * rewording any of these strings fails a test instead of silently telling a
 * machine consumer to log in when the real problem is the git remote.
 *
 * Origin 4, a `resolveOrgSubject` failure, is absent on purpose and is
 * covered by its own test below: it cannot throw.
 */
describe("resolveIdentity failure codes (--json)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-identity-"));
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

  /** A `--from` payload valid enough to reach the identity step. */
  async function writeCreateInput(): Promise<string> {
    const file = join(cwd, "create.json");
    await writeFile(file, JSON.stringify({ prompt: "no eval" }));
    return file;
  }

  async function writeImproveInput(): Promise<string> {
    const file = join(cwd, "improve.json");
    await writeFile(
      file,
      JSON.stringify({ ruleId: "some-rule", guidance: "be stricter" })
    );
    return file;
  }

  /** Turn `cwd` into a git repo whose `origin` is `url`. */
  async function initRepoWithOrigin(url: string): Promise<void> {
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["remote", "add", "origin", url], { cwd });
  }

  const withToken = { TASKLESS_TOKEN: "test-token-not-a-real-credential" };

  describe("origin 1: no token", () => {
    it("emits AUTH_REQUIRED from rule create", async () => {
      const from = await writeCreateInput();
      const result = await runCli([
        "rule",
        "create",
        "--from",
        from,
        "--json",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(parseEnvelope(result.stdout).code).toBe("AUTH_REQUIRED");
    });

    it("emits AUTH_REQUIRED from rule improve", async () => {
      const from = await writeImproveInput();
      const result = await runCli([
        "rule",
        "improve",
        "--from",
        from,
        "--json",
        "-d",
        cwd,
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(parseEnvelope(result.stdout).code).toBe("AUTH_REQUIRED");
    });
  });

  describe("origin 2a: not a git repository", () => {
    it("emits NOT_A_GIT_REPOSITORY from rule create", async () => {
      const from = await writeCreateInput();
      const result = await runCli(
        ["rule", "create", "--from", from, "--json", "-d", cwd],
        withToken
      );
      expect(result.exitCode).not.toBe(0);
      expect(parseEnvelope(result.stdout).code).toBe("NOT_A_GIT_REPOSITORY");
    });

    it("emits NOT_A_GIT_REPOSITORY from rule improve", async () => {
      const from = await writeImproveInput();
      const result = await runCli(
        ["rule", "improve", "--from", from, "--json", "-d", cwd],
        withToken
      );
      expect(result.exitCode).not.toBe(0);
      expect(parseEnvelope(result.stdout).code).toBe("NOT_A_GIT_REPOSITORY");
    });
  });

  describe("origin 2b: a git repository with no origin remote", () => {
    // Split from 2a deliberately. Both fail the same `git remote get-url
    // origin` call, which is why they were once one code, but the remedies
    // differ: `git init` versus adding a remote.
    beforeEach(async () => {
      await execFileAsync("git", ["init"], { cwd });
    });

    it("emits NO_ORIGIN_REMOTE from rule create", async () => {
      const from = await writeCreateInput();
      const result = await runCli(
        ["rule", "create", "--from", from, "--json", "-d", cwd],
        withToken
      );
      expect(result.exitCode).not.toBe(0);
      expect(parseEnvelope(result.stdout).code).toBe("NO_ORIGIN_REMOTE");
    });

    it("emits NO_ORIGIN_REMOTE from rule improve", async () => {
      const from = await writeImproveInput();
      const result = await runCli(
        ["rule", "improve", "--from", from, "--json", "-d", cwd],
        withToken
      );
      expect(result.exitCode).not.toBe(0);
      expect(parseEnvelope(result.stdout).code).toBe("NO_ORIGIN_REMOTE");
    });
  });

  describe("origin 3: origin remote is not GitHub", () => {
    it("emits UNSUPPORTED_REMOTE_HOST from rule create", async () => {
      await initRepoWithOrigin("https://gitlab.com/acme/widgets.git");
      const from = await writeCreateInput();
      const result = await runCli(
        ["rule", "create", "--from", from, "--json", "-d", cwd],
        withToken
      );
      expect(result.exitCode).not.toBe(0);
      expect(parseEnvelope(result.stdout).code).toBe("UNSUPPORTED_REMOTE_HOST");
    });

    it("emits UNSUPPORTED_REMOTE_HOST from rule improve", async () => {
      await initRepoWithOrigin("git@gitea.example.com:acme/widgets.git");
      const from = await writeImproveInput();
      const result = await runCli(
        ["rule", "improve", "--from", from, "--json", "-d", cwd],
        withToken
      );
      expect(result.exitCode).not.toBe(0);
      expect(parseEnvelope(result.stdout).code).toBe("UNSUPPORTED_REMOTE_HOST");
    });
  });

  it("does not read the code out of the message text", async () => {
    // The old implementation picked the code with `/git remote|origin/i` over
    // the message. Pin the property that replaced it: an AUTH_REQUIRED
    // failure keeps its code even though its message names neither term, and
    // a no-remote failure keeps its code independently of its wording.
    const from = await writeCreateInput();
    const args = ["rule", "create", "--from", from, "--json", "-d", cwd];

    const noTokenRun = await runCli(args);
    const noToken = parseEnvelope(noTokenRun.stdout);
    expect(noToken.code).toBe("AUTH_REQUIRED");
    expect(noToken.message).not.toMatch(/git remote|origin/i);

    const noRemoteRun = await runCli(args, withToken);
    const noRemote = parseEnvelope(noRemoteRun.stdout);
    expect(noRemote.code).toBe("NOT_A_GIT_REPOSITORY");
  });

  it("never reports a missing remote as an auth failure", async () => {
    // These three are a capability boundary on remote generation, not a
    // credential problem. An agent that saw AUTH_REQUIRED here would send the
    // user through `auth login`, which cannot fix any of them.
    const from = await writeCreateInput();
    const args = ["rule", "create", "--from", from, "--json", "-d", cwd];

    const notARepoRun = await runCli(args, withToken);
    const notARepo = parseEnvelope(notARepoRun.stdout);

    await execFileAsync("git", ["init"], { cwd });
    const noOriginRun = await runCli(args, withToken);
    const noOrigin = parseEnvelope(noOriginRun.stdout);

    await execFileAsync(
      "git",
      ["remote", "add", "origin", "https://gitlab.com/acme/widgets.git"],
      { cwd }
    );
    const notGitHubRun = await runCli(args, withToken);
    const notGitHub = parseEnvelope(notGitHubRun.stdout);

    for (const envelope of [notARepo, noOrigin, notGitHub]) {
      expect(envelope.code).not.toBe("AUTH_REQUIRED");
      // Each names the local path that still works, so the refusal is a
      // boundary the reader can route around rather than a dead end.
      expect(envelope.message).toMatch(/local rule authoring/i);
    }

    // The three are genuinely distinct, which is the point: the remedies are
    // `git init`, adding a remote, and "this host is not supported", and one
    // collapsed code cannot tell them apart.
    expect(new Set([notARepo.code, noOrigin.code, notGitHub.code]).size).toBe(
      3
    );
  });
});

/**
 * Origin 4 of #181: a `resolveOrgSubject` failure. There is no such failure
 * to give a code to. `fetchWhoami` returns `undefined` on any network or HTTP
 * error, and `decodeOrgId` falls back to the nil-UUID `NIL_ORG_ID`, so the
 * step resolves a subject rather than throwing. This test holds that shape in
 * place: if `resolveOrgSubject` ever grows a throw, it needs a code of its
 * own and this test says so by failing.
 */
describe("resolveOrgSubject", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-org-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("resolves a subject instead of throwing when whoami is unreachable", async () => {
    // An unroutable base url makes the whoami request fail outright.
    const previous = process.env.TASKLESS_API_URL;
    process.env.TASKLESS_API_URL = "http://127.0.0.1:1/cli";
    try {
      await expect(
        resolveOrgSubject(cwd, "not-a-real-token")
      ).resolves.toBeDefined();
    } finally {
      if (previous === undefined) {
        delete process.env.TASKLESS_API_URL;
      } else {
        process.env.TASKLESS_API_URL = previous;
      }
    }
  });
});
