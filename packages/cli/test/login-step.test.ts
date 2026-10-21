import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { whoami } from "../src/api/v2";
import { loginStep } from "../src/auth/login-step";
import {
  type PendingLogin,
  readPendingLogin,
  savePendingLogin,
} from "../src/auth/pending-login";

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

const START = 1_800_000_000_000;

let cwd: string;
let previousToken: string | undefined;
let clock: number;

/** A clock that only moves when the step sleeps, so waits cost nothing. */
const time = {
  now: () => clock,
  sleep: (ms: number) => {
    clock += ms;
    return Promise.resolve();
  },
};

const PENDING: PendingLogin = {
  deviceCode: "device-123",
  userCode: "ABCD-EFGH",
  verificationUrl: "https://taskless.io/device?code=ABCD-EFGH",
  interval: 5,
  expiresAt: START + 600_000,
};

function issueCode(code = "WXYZ-1234"): void {
  mockedRequestDeviceCode.mockResolvedValue({
    device_code: `device-${code}`,
    user_code: code,
    verification_uri: "https://taskless.io/device",
    verification_uri_complete: `https://taskless.io/device?code=${code}`,
    expires_in: 600,
    interval: 5,
  });
}

async function savedToken(): Promise<string | undefined> {
  const raw = await readFile(join(cwd, ".taskless", ".env.local.json"), "utf8");
  return (JSON.parse(raw) as { access_token?: string }).access_token;
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "taskless-login-step-"));
  previousToken = process.env.TASKLESS_TOKEN;
  delete process.env.TASKLESS_TOKEN;
  clock = START;
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

/**
 * `auth login --json` as a step an agent repeats: the first returns the URL
 * at once, each later one waits a bounded time and reports where it got to.
 */
describe("a login step", () => {
  it("starts a login and returns its URL without polling", async () => {
    issueCode("WXYZ-1234");
    const result = await loginStep({ cwd, ...time });
    expect(result).toEqual({
      status: "pending",
      verificationUrl: "https://taskless.io/device?code=WXYZ-1234",
      userCode: "WXYZ-1234",
      expiresAt: START + 600_000,
    });
    expect(mockedPollForToken).not.toHaveBeenCalled();
    expect(clock).toBe(START);
    expect(await readPendingLogin(cwd)).toMatchObject({
      deviceCode: "device-WXYZ-1234",
    });
  });

  it("finishes a pending login the user approved", async () => {
    await savePendingLogin(cwd, PENDING);
    mockedPollForToken
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({
        status: "success",
        token: { access_token: "fresh-token", token_type: "Bearer" },
      });
    const result = await loginStep({ cwd, ...time });
    expect(result).toEqual({ status: "authenticated" });
    expect(await savedToken()).toBe("fresh-token");
    expect(await readPendingLogin(cwd)).toBeUndefined();
    expect(mockedRequestDeviceCode).not.toHaveBeenCalled();
  });

  it("returns the same URL and code when its wait runs out", async () => {
    await savePendingLogin(cwd, PENDING);
    mockedPollForToken.mockResolvedValue({ status: "pending" });
    const result = await loginStep({ cwd, ...time });
    expect(result).toEqual({
      status: "pending",
      verificationUrl: PENDING.verificationUrl,
      userCode: PENDING.userCode,
      expiresAt: PENDING.expiresAt,
    });
    // 45 seconds of 5-second polls, and not one past the wait.
    expect(mockedPollForToken).toHaveBeenCalledTimes(9);
    expect(clock - START).toBeLessThanOrEqual(45_000);
    expect(await readPendingLogin(cwd)).toEqual(PENDING);
  });

  it("reports a denial and forgets the login", async () => {
    await savePendingLogin(cwd, PENDING);
    mockedPollForToken.mockResolvedValue({ status: "denied" });
    expect(await loginStep({ cwd, ...time })).toEqual({
      status: "failed",
      reason: "denied",
    });
    expect(await readPendingLogin(cwd)).toBeUndefined();
  });

  it("reports a code the service says expired", async () => {
    await savePendingLogin(cwd, PENDING);
    mockedPollForToken.mockResolvedValue({ status: "expired" });
    expect(await loginStep({ cwd, ...time })).toEqual({
      status: "failed",
      reason: "expired",
    });
    expect(await readPendingLogin(cwd)).toBeUndefined();
  });

  it("reports a code that runs out during its wait", async () => {
    await savePendingLogin(cwd, { ...PENDING, expiresAt: START + 12_000 });
    mockedPollForToken.mockResolvedValue({ status: "pending" });
    expect(await loginStep({ cwd, ...time })).toEqual({
      status: "failed",
      reason: "expired",
    });
    expect(clock - START).toBeLessThan(45_000);
    expect(await readPendingLogin(cwd)).toBeUndefined();
  });

  it("replaces a login that expired before it began, without reporting it", async () => {
    await savePendingLogin(cwd, { ...PENDING, expiresAt: START - 1 });
    issueCode("NEWC-0DE0");
    const result = await loginStep({ cwd, ...time });
    expect(result).toMatchObject({ status: "pending", userCode: "NEWC-0DE0" });
    expect(mockedPollForToken).not.toHaveBeenCalled();
  });

  it("backs off on slow_down and keeps the slower pace for the next step", async () => {
    await savePendingLogin(cwd, PENDING);
    mockedPollForToken
      .mockResolvedValueOnce({ status: "slow_down" })
      .mockResolvedValue({ status: "pending" });
    await loginStep({ cwd, ...time });
    // One poll at 5s, then every 10s: 5, 15, 25, 35, 45.
    expect(mockedPollForToken).toHaveBeenCalledTimes(5);
    expect(await readPendingLogin(cwd)).toMatchObject({ interval: 10 });
  });

  it("keeps the pending login when a request fails", async () => {
    await savePendingLogin(cwd, PENDING);
    mockedPollForToken.mockRejectedValue(new Error("socket hang up"));
    expect(await loginStep({ cwd, ...time })).toEqual({
      status: "failed",
      reason: "error",
      message: "socket hang up",
    });
    expect(await readPendingLogin(cwd)).toEqual(PENDING);
  });

  it("keeps a saved token the service accepts, before touching any pending login", async () => {
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", ".env.local.json"),
      JSON.stringify({ access_token: "good-token" })
    );
    mockedWhoami.mockResolvedValue({
      status: "ok",
      data: { user: "someone", orgs: [] } as never,
    });
    expect(await loginStep({ cwd, ...time })).toEqual({
      status: "already_logged_in",
      source: "saved",
    });
    expect(mockedRequestDeviceCode).not.toHaveBeenCalled();
  });

  it("names TASKLESS_TOKEN without asking the service", async () => {
    process.env.TASKLESS_TOKEN = "env-token";
    expect(await loginStep({ cwd, ...time })).toEqual({
      status: "already_logged_in",
      source: "environment",
    });
    expect(mockedWhoami).not.toHaveBeenCalled();
  });
});
