import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getToken, saveToken, removeToken } from "../src/auth/token";

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-token-test-"));
  delete process.env.TASKLESS_TOKEN;
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(temporaryDirectory, { recursive: true, force: true });
});

/** Write a raw .env.local.json to the temp .taskless directory */
async function writeAuthFile(data: Record<string, unknown>): Promise<void> {
  const directory = join(temporaryDirectory, ".taskless");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, ".env.local.json"), JSON.stringify(data));
}

/** Read the raw .env.local.json from the temp .taskless directory */
async function readAuthFile(): Promise<Record<string, unknown>> {
  const raw = await readFile(
    join(temporaryDirectory, ".taskless", ".env.local.json"),
    "utf8"
  );
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("getToken", () => {
  describe("valid token", () => {
    it("returns the token when expires_at is in the future", async () => {
      await writeAuthFile({
        access_token: "valid-token",
        expires_at: Date.now() + 60_000,
      });
      expect(await getToken(temporaryDirectory)).toBe("valid-token");
    });

    it("returns the token when no expires_at is stored (legacy auth files)", async () => {
      await writeAuthFile({ access_token: "legacy-token" });
      expect(await getToken(temporaryDirectory)).toBe("legacy-token");
    });
  });

  describe("expired token", () => {
    it("returns undefined when expires_at is in the past", async () => {
      await writeAuthFile({
        access_token: "expired-token",
        expires_at: Date.now() - 1000,
      });
      expect(await getToken(temporaryDirectory)).toBeUndefined();
    });

    it("returns undefined when expires_at is exactly now", async () => {
      const now = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(now);
      await writeAuthFile({
        access_token: "edge-token",
        expires_at: now,
      });
      expect(await getToken(temporaryDirectory)).toBeUndefined();
    });
  });

  describe("missing data", () => {
    it("returns undefined when no cwd is provided", async () => {
      expect(await getToken()).toBeUndefined();
    });

    it("returns undefined when auth file does not exist", async () => {
      expect(await getToken(temporaryDirectory)).toBeUndefined();
    });

    it("returns undefined when access_token is missing from file", async () => {
      await writeAuthFile({ expires_at: Date.now() + 60_000 });
      expect(await getToken(temporaryDirectory)).toBeUndefined();
    });
  });

  describe("corrupted data", () => {
    it("returns undefined when auth file contains invalid JSON", async () => {
      const directory = join(temporaryDirectory, ".taskless");
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, ".env.local.json"), "not-json{{{");
      expect(await getToken(temporaryDirectory)).toBeUndefined();
    });

    it("returns undefined when auth file is empty", async () => {
      const directory = join(temporaryDirectory, ".taskless");
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, ".env.local.json"), "");
      expect(await getToken(temporaryDirectory)).toBeUndefined();
    });

    it("returns token when expires_at is not a number (treated as no expiry)", async () => {
      await writeAuthFile({
        access_token: "bad-expiry",
        expires_at: "not-a-number",
      });
      expect(await getToken(temporaryDirectory)).toBe("bad-expiry");
    });
  });

  describe("env var override", () => {
    it("returns TASKLESS_TOKEN env var regardless of file state", async () => {
      await writeAuthFile({
        access_token: "file-token",
        expires_at: Date.now() - 1000, // expired
      });
      process.env.TASKLESS_TOKEN = "env-token";
      expect(await getToken(temporaryDirectory)).toBe("env-token");
    });
  });
});

describe("saveToken", () => {
  it("computes expires_at from expires_in", async () => {
    const before = Date.now();
    await saveToken(
      { access_token: "new-token", expires_in: 3600 },
      temporaryDirectory
    );
    const after = Date.now();

    const saved = await readAuthFile();
    expect(saved.access_token).toBe("new-token");
    expect(saved.expires_in).toBe(3600);
    expect(typeof saved.expires_at).toBe("number");
    expect(saved.expires_at as number).toBeGreaterThanOrEqual(
      before + 3600 * 1000
    );
    expect(saved.expires_at as number).toBeLessThanOrEqual(after + 3600 * 1000);
  });

  it("does not set expires_at when expires_in is not provided", async () => {
    await saveToken({ access_token: "no-expiry-token" }, temporaryDirectory);
    const saved = await readAuthFile();
    expect(saved.access_token).toBe("no-expiry-token");
    expect(saved).not.toHaveProperty("expires_at");
  });

  it("does nothing when cwd is not provided", async () => {
    await saveToken({ access_token: "orphan-token" });
    expect(await getToken(temporaryDirectory)).toBeUndefined();
  });
});

describe("removeToken", () => {
  it("returns true and removes the file when it exists", async () => {
    await saveToken({ access_token: "to-remove" }, temporaryDirectory);
    expect(await removeToken(temporaryDirectory)).toBe(true);
    expect(await getToken(temporaryDirectory)).toBeUndefined();
  });

  it("returns false when no auth file exists", async () => {
    expect(await removeToken(temporaryDirectory)).toBe(false);
  });

  it("returns false when no cwd is provided", async () => {
    expect(await removeToken()).toBe(false);
  });
});

describe("tracked token warning", () => {
  it("tells the user to untrack the file, not just gitignore it", async () => {
    await writeAuthFile({ access_token: "tracked-token" });
    execFileSync("git", ["init", "-q"], { cwd: temporaryDirectory });
    execFileSync("git", ["add", ".taskless/.env.local.json"], {
      cwd: temporaryDirectory,
    });
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((message: unknown) => {
      errors.push(String(message));
    });

    expect(await getToken(temporaryDirectory)).toBe("tracked-token");

    const warning = errors.find((line) => line.includes("tracked by git"));
    expect(warning).toContain("git rm --cached .taskless/.env.local.json");
    expect(warning).toContain("auth logout");
    expect(warning).toContain("auth login");
    expect(warning).toContain("does not revoke");
  });

  it("stays quiet when the file is not tracked", async () => {
    await writeAuthFile({ access_token: "untracked-token" });
    execFileSync("git", ["init", "-q"], { cwd: temporaryDirectory });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await getToken(temporaryDirectory)).toBe("untracked-token");
    expect(
      spy.mock.calls.some((call) => String(call[0]).includes("tracked by git"))
    ).toBe(false);
  });
});
