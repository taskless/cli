import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../src/telemetry", () => ({
  getTelemetry: vi.fn(() =>
    Promise.resolve({ capture: vi.fn(), shutdown: () => Promise.resolve() })
  ),
}));

const { authCommand } = await import("../src/commands/auth");

let cwd: string;
let previousToken: string | undefined;
let logSpy: ReturnType<typeof vi.spyOn>;

async function run(...args: string[]): Promise<unknown> {
  await runCommand(authCommand, { rawArgs: [...args, "-d", cwd] });
  const [line] = logSpy.mock.calls.map((call) => String(call[0]));
  return line === undefined ? undefined : JSON.parse(line);
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "taskless-auth-login-json-"));
  previousToken = process.env.TASKLESS_TOKEN;
  delete process.env.TASKLESS_TOKEN;
  process.exitCode = undefined;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  logSpy.mockRestore();
  vi.resetAllMocks();
  process.exitCode = undefined;
  if (previousToken === undefined) {
    delete process.env.TASKLESS_TOKEN;
  } else {
    process.env.TASKLESS_TOKEN = previousToken;
  }
  await rm(cwd, { recursive: true, force: true });
});

/** What an agent reads from each `auth login --json` step. */
describe("auth login --json", () => {
  it("prints the URL and code of a new login, with its expiry", async () => {
    mockedRequestDeviceCode.mockResolvedValue({
      device_code: "device-1",
      user_code: "ABCD-EFGH",
      verification_uri: "https://taskless.io/device",
      verification_uri_complete: "https://taskless.io/device?code=ABCD-EFGH",
      expires_in: 600,
      interval: 5,
    });
    const envelope = (await run("login", "--json")) as Record<string, unknown>;
    expect(envelope).toMatchObject({
      ok: true,
      status: "pending",
      verificationUrl: "https://taskless.io/device?code=ABCD-EFGH",
      userCode: "ABCD-EFGH",
    });
    expect(Date.parse(String(envelope.expiresAt))).toBeGreaterThan(Date.now());
    expect(process.exitCode).toBeUndefined();
  });

  it("prints authenticated when a pending login is approved", async () => {
    await savePendingLogin(cwd, {
      deviceCode: "device-1",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://taskless.io/device",
      interval: 0,
      expiresAt: Date.now() + 600_000,
    });
    mockedPollForToken.mockResolvedValue({
      status: "success",
      token: { access_token: "fresh-token", token_type: "Bearer" },
    });
    expect(await run("login", "--json")).toEqual({
      ok: true,
      status: "authenticated",
    });
  });

  it("prints already_logged_in for TASKLESS_TOKEN", async () => {
    process.env.TASKLESS_TOKEN = "env-token";
    expect(await run("login", "--json")).toEqual({
      ok: true,
      status: "already_logged_in",
      source: "environment",
    });
  });

  it("fails with AUTH_EXPIRED when the code expires", async () => {
    await savePendingLogin(cwd, {
      deviceCode: "device-1",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://taskless.io/device",
      interval: 0,
      expiresAt: Date.now() + 600_000,
    });
    mockedPollForToken.mockResolvedValue({ status: "expired" });
    expect(await run("login", "--json")).toMatchObject({
      ok: false,
      code: "AUTH_EXPIRED",
    });
    expect(process.exitCode).toBe(1);
  });
});

describe("auth logout", () => {
  it("discards a pending login", async () => {
    const pending: PendingLogin = {
      deviceCode: "device-1",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://taskless.io/device",
      interval: 5,
      expiresAt: Date.now() + 600_000,
    };
    await savePendingLogin(cwd, pending);
    await runCommand(authCommand, { rawArgs: ["logout", "-d", cwd] });
    expect(await readPendingLogin(cwd)).toBeUndefined();
  });
});
