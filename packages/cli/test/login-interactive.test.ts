import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { whoami } from "../src/api/v2";
import { loginInteractive } from "../src/auth/login-interactive";
import {
  clearPendingLogin,
  type PendingLogin,
  readPendingLogin,
  savePendingLogin,
} from "../src/auth/pending-login";
import { rejectedTokenRemedy } from "../src/auth/token";

const { mockedRequestDeviceCode, mockedPollForToken } = vi.hoisted(() => ({
  mockedRequestDeviceCode: vi.fn(),
  mockedPollForToken: vi.fn(),
}));

vi.mock("../src/api/v2", () => ({ whoami: vi.fn() }));
vi.mock("../src/auth/device-flow", () => ({
  deviceFlowProvider: {
    requestDeviceCode: mockedRequestDeviceCode,
    pollForToken: mockedPollForToken,
  },
}));

const mockedWhoami = vi.mocked(whoami);

let cwd: string;
let previousToken: string | undefined;

/** Write a per-repo saved token, as `auth login` would. */
async function saveTokenFile(accessToken: string): Promise<void> {
  await mkdir(join(cwd, ".taskless"), { recursive: true });
  await writeFile(
    join(cwd, ".taskless", ".env.local.json"),
    JSON.stringify({ access_token: accessToken })
  );
}

async function readSavedToken(): Promise<string | undefined> {
  const raw = await readFile(join(cwd, ".taskless", ".env.local.json"), "utf8");
  return (JSON.parse(raw) as { access_token?: string }).access_token;
}

function quiet(): {
  out: (l: string) => void;
  err: (l: string) => void;
  logs: string[];
  errors: string[];
} {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    out: (l) => logs.push(l),
    err: (l) => errors.push(l),
    logs,
    errors,
  };
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "taskless-login-interactive-"));
  previousToken = process.env.TASKLESS_TOKEN;
  delete process.env.TASKLESS_TOKEN;
});

afterEach(async () => {
  vi.resetAllMocks();
  if (previousToken === undefined) {
    delete process.env.TASKLESS_TOKEN;
  } else {
    process.env.TASKLESS_TOKEN = previousToken;
  }
  await rm(cwd, { recursive: true, force: true });
});

describe("loginInteractive", () => {
  it("short-circuits with already_logged_in when TASKLESS_TOKEN is set, without asking the service", async () => {
    process.env.TASKLESS_TOKEN = "env-token";

    const sinks = quiet();
    const result = await loginInteractive({ cwd, ...sinks });

    expect(result).toEqual({
      status: "already_logged_in",
      source: "environment",
    });
    expect(mockedWhoami).not.toHaveBeenCalled();
    expect(sinks.logs).toEqual([]);
    expect(sinks.errors).toEqual([]);
  });

  it("keeps a saved token the service accepts", async () => {
    await saveTokenFile("good-token");
    mockedWhoami.mockResolvedValue({
      status: "ok",
      data: { user: "someone", orgs: [] } as never,
    });

    const result = await loginInteractive({ cwd, ...quiet() });

    expect(result).toEqual({ status: "already_logged_in", source: "saved" });
    expect(mockedRequestDeviceCode).not.toHaveBeenCalled();
    expect(await readSavedToken()).toBe("good-token");
  });

  it("keeps a saved token when the service is unreachable, since that says nothing about the token", async () => {
    await saveTokenFile("good-token");
    mockedWhoami.mockResolvedValue({
      status: "unavailable",
      reason: "network error: offline",
      retryable: true,
    });

    const result = await loginInteractive({ cwd, ...quiet() });

    expect(result).toEqual({ status: "already_logged_in", source: "saved" });
    expect(mockedRequestDeviceCode).not.toHaveBeenCalled();
  });

  it("replaces a saved token the service rejects", async () => {
    await saveTokenFile("revoked-token");
    mockedWhoami.mockResolvedValue({ status: "unauthorized" });
    mockedRequestDeviceCode.mockResolvedValue({
      device_code: "device",
      user_code: "ABCD-EFGH",
      verification_uri: "https://example.test/device",
      expires_in: 600,
      // Polls immediately, so the flow completes without waiting on a timer.
      interval: 0,
    });
    mockedPollForToken.mockResolvedValue({
      status: "success",
      token: { access_token: "fresh-token", token_type: "Bearer" },
    });

    const sinks = quiet();
    const result = await loginInteractive({ cwd, ...sinks });

    expect(mockedWhoami).toHaveBeenCalledWith("revoked-token");
    expect(result).toEqual({ status: "ok" });
    expect(await readSavedToken()).toBe("fresh-token");
    expect(sinks.logs).toContain("Logged in successfully.");
  });
  it("finishes a login started under --json, so it cannot complete twice", async () => {
    await savePendingLogin(cwd, {
      deviceCode: "stale-device",
      userCode: "OLDC-0DE0",
      verificationUrl: "https://example.test/device",
      interval: 5,
      expiresAt: Date.now() + 600_000,
    });
    mockedRequestDeviceCode.mockResolvedValue({
      device_code: "device",
      user_code: "ABCD-EFGH",
      verification_uri: "https://example.test/device",
      expires_in: 600,
      interval: 0,
    });
    mockedPollForToken.mockResolvedValue({
      status: "success",
      token: { access_token: "fresh-token", token_type: "Bearer" },
    });

    expect(await loginInteractive({ cwd, ...quiet() })).toEqual({
      status: "ok",
    });
    expect(await readPendingLogin(cwd)).toBeUndefined();
  });
});

/** Whether any token file was written. */
async function hasSavedToken(): Promise<boolean> {
  try {
    await readFile(join(cwd, ".taskless", ".env.local.json"), "utf8");
    return true;
  } catch {
    return false;
  }
}

const START = 1_800_000_000_000;

/**
 * A clock that only moves when the login sleeps, with `during` run once, the
 * first time it does: the moment another shell acts while this one waits.
 */
function waitingWhile(during: () => Promise<void> = () => Promise.resolve()) {
  let clock = START;
  let ran = false;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
      if (!ran) {
        ran = true;
        await during();
      }
    },
  };
}

function issueCode(): void {
  mockedRequestDeviceCode.mockResolvedValue({
    device_code: "device-own",
    user_code: "ABCD-EFGH",
    verification_uri: "https://example.test/device",
    verification_uri_complete: "https://example.test/device?code=ABCD-EFGH",
    expires_in: 600,
    // Short, so a run against a build that ignores the injected sleep fails
    // on its assertions rather than on the test timeout.
    interval: 1,
  });
}

function approve(): void {
  mockedPollForToken.mockResolvedValue({
    status: "success",
    token: { access_token: "fresh-token", token_type: "Bearer" },
  });
}

/**
 * The interactive login records itself as pending while it waits, so that
 * `auth logout` or another login run from a different shell can cancel it.
 */
describe("loginInteractive while it waits", () => {
  it("records itself as an interactive pending login", async () => {
    issueCode();
    approve();
    let seen: PendingLogin | undefined;
    const result = await loginInteractive({
      cwd,
      ...quiet(),
      ...waitingWhile(async () => {
        seen = await readPendingLogin(cwd);
      }),
    });
    expect(result).toEqual({ status: "ok" });
    expect(seen).toEqual({
      deviceCode: "device-own",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://example.test/device?code=ABCD-EFGH",
      interval: 1,
      expiresAt: START + 600_000,
      mode: "interactive",
    });
    // Finished, so no longer pending.
    expect(await readPendingLogin(cwd)).toBeUndefined();
  });

  it("saves no token when auth logout ran while it waited, though the user then approves", async () => {
    issueCode();
    approve();
    const sinks = quiet();
    const result = await loginInteractive({
      cwd,
      ...sinks,
      ...waitingWhile(() => clearPendingLogin(cwd)),
    });
    expect(result).toEqual({ status: "cancelled", reason: "cancelled" });
    expect(await hasSavedToken()).toBe(false);
    expect(sinks.logs).not.toContain("Logged in successfully.");
  });

  it("leaves alone a login another process started while it waited", async () => {
    issueCode();
    approve();
    const replacement: PendingLogin = {
      deviceCode: "device-other",
      userCode: "WXYZ-1234",
      verificationUrl: "https://example.test/device?code=WXYZ-1234",
      interval: 5,
      expiresAt: START + 600_000,
      mode: "step",
    };
    const result = await loginInteractive({
      cwd,
      ...quiet(),
      ...waitingWhile(() => savePendingLogin(cwd, replacement)),
    });
    expect(result).toEqual({ status: "cancelled", reason: "cancelled" });
    expect(await hasSavedToken()).toBe(false);
    // Its pending file is the other login's, and is not deleted.
    expect(await readPendingLogin(cwd)).toEqual(replacement);
  });

  it("forgets its own pending login on a denial", async () => {
    issueCode();
    mockedPollForToken.mockResolvedValue({ status: "denied" });
    expect(
      await loginInteractive({ cwd, ...quiet(), ...waitingWhile() })
    ).toEqual({ status: "cancelled", reason: "denied" });
    expect(await readPendingLogin(cwd)).toBeUndefined();
  });
});

describe("rejectedTokenRemedy", () => {
  it("sends a saved token to auth login", () => {
    expect(rejectedTokenRemedy()).toMatch(/auth login` to replace/);
    expect(rejectedTokenRemedy()).not.toMatch(/TASKLESS_TOKEN/);
  });

  it("names TASKLESS_TOKEN when the token comes from the environment", () => {
    process.env.TASKLESS_TOKEN = "env-token";

    const remedy = rejectedTokenRemedy();

    expect(remedy).toMatch(/TASKLESS_TOKEN/);
    expect(remedy).toMatch(/replace or unset it/);
  });
});
