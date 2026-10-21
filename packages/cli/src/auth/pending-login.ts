import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { addToGitignore } from "../filesystem/gitignore";

const PENDING_LOGIN_FILE = ".auth-pending.json";

/**
 * A device-code login that has been started and not yet finished, saved so
 * that `auth login --json` can continue it from a later process.
 *
 * The device code is a credential until it expires: whoever polls with it
 * receives the token the user approves. It is kept beside the saved token,
 * with the same mode and the same gitignore entry.
 */
export interface PendingLogin {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  /** Seconds between polls, as the service last asked for. */
  interval: number;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

/** The pending login in `cwd`, or `undefined` when none is saved or it is unreadable. */
export async function readPendingLogin(
  cwd: string
): Promise<PendingLogin | undefined> {
  let data: Partial<PendingLogin>;
  try {
    const raw = await readFile(
      join(cwd, ".taskless", PENDING_LOGIN_FILE),
      "utf8"
    );
    data = JSON.parse(raw) as Partial<PendingLogin>;
  } catch {
    return undefined;
  }
  // A file this CLI did not write in full is not one it can continue.
  if (
    typeof data.deviceCode !== "string" ||
    typeof data.userCode !== "string" ||
    typeof data.verificationUrl !== "string" ||
    typeof data.interval !== "number" ||
    typeof data.expiresAt !== "number"
  ) {
    return undefined;
  }
  return {
    deviceCode: data.deviceCode,
    userCode: data.userCode,
    verificationUrl: data.verificationUrl,
    interval: data.interval,
    expiresAt: data.expiresAt,
  };
}

/** Save a pending login to `.taskless/.auth-pending.json`, readable only by its owner. */
export async function savePendingLogin(
  cwd: string,
  pending: PendingLogin
): Promise<void> {
  await mkdir(join(cwd, ".taskless"), { recursive: true });
  await addToGitignore(cwd, [PENDING_LOGIN_FILE]);
  await writeFile(
    join(cwd, ".taskless", PENDING_LOGIN_FILE),
    JSON.stringify(pending, null, 2) + "\n",
    { mode: 0o600 }
  );
}

/** Remove a pending login, if one is saved. */
export async function clearPendingLogin(cwd: string): Promise<void> {
  await rm(join(cwd, ".taskless", PENDING_LOGIN_FILE), { force: true });
}
