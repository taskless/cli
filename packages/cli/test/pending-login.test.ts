import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearPendingLogin,
  type PendingLogin,
  readPendingLogin,
  savePendingLogin,
} from "../src/auth/pending-login";

const PENDING: PendingLogin = {
  deviceCode: "device-123",
  userCode: "ABCD-EFGH",
  verificationUrl: "https://taskless.io/device?code=ABCD-EFGH",
  interval: 5,
  expiresAt: 1_900_000_000_000,
};

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "taskless-pending-login-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

/**
 * A started device-code login, saved so a later `auth login --json` can
 * continue it. The device code is a credential until it expires.
 */
describe("the pending login file", () => {
  it("reads back what was saved", async () => {
    await savePendingLogin(cwd, PENDING);
    expect(await readPendingLogin(cwd)).toEqual(PENDING);
  });

  it("is readable only by its owner and ignored by git", async () => {
    await savePendingLogin(cwd, PENDING);
    const info = await stat(join(cwd, ".taskless", ".auth-pending.json"));
    expect(info.mode & 0o777).toBe(0o600);
    const ignored = await readFile(
      join(cwd, ".taskless", ".gitignore"),
      "utf8"
    );
    expect(ignored.split("\n")).toContain(".auth-pending.json");
  });

  it("is gone after it is cleared", async () => {
    await savePendingLogin(cwd, PENDING);
    await clearPendingLogin(cwd);
    expect(await readPendingLogin(cwd)).toBeUndefined();
  });

  it("clears quietly when nothing is saved", async () => {
    await expect(clearPendingLogin(cwd)).resolves.toBeUndefined();
  });

  it("reads a missing, malformed, or partial file as no pending login", async () => {
    expect(await readPendingLogin(cwd)).toBeUndefined();
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    const path = join(cwd, ".taskless", ".auth-pending.json");
    await writeFile(path, "{ not json");
    expect(await readPendingLogin(cwd)).toBeUndefined();
    await writeFile(path, JSON.stringify({ deviceCode: "device-123" }));
    expect(await readPendingLogin(cwd)).toBeUndefined();
  });
});
