import process from "node:process";

import { deviceFlowProvider } from "./device-flow";
import {
  clearOwnPendingLogin,
  isPendingLogin,
  savePendingLogin,
} from "./pending-login";
import { getToken, isEnvironmentToken, saveToken } from "./token";
import { whoami } from "../api/v2";
import { resolveRepositoryUrl } from "../util/git-remote";

export type LoginResult =
  | { status: "ok" }
  | { status: "already_logged_in"; source: "environment" | "saved" }
  | {
      status: "cancelled";
      /**
       * `cancelled`: the pending login this flow recorded was removed (by
       * `auth logout`) or replaced (by another login) while it waited, so no
       * token was saved.
       */
      reason: "expired" | "denied" | "cancelled" | "error";
      message?: string;
    };

export interface LoginInteractiveOptions {
  cwd?: string;
  /** Sink for user-facing progress lines. Defaults to console.log. */
  out?: (line: string) => void;
  /** Sink for error lines. Defaults to console.error. */
  err?: (line: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Where the token that makes a new login unnecessary comes from, or
 * `undefined` when there is none to keep.
 */
export async function existingLoginSource(
  cwd: string
): Promise<"environment" | "saved" | undefined> {
  // Silent: this is only an "already logged in?" probe. Stderr warnings from
  // legacy/tracked-token checks belong to the commands that use the token,
  // not to the login flow that is about to replace it.
  const existing = await getToken(cwd, { silent: true });
  if (!existing) return undefined;
  // A token from TASKLESS_TOKEN outranks anything this flow could save, so
  // logging in would change nothing the next command reads.
  if (isEnvironmentToken()) return "environment";
  // A saved token the service rejects is the reason the user is here: every
  // 401 message sends them to `auth login`. Only a definite rejection is
  // replaced; an unreachable service says nothing about the token.
  const verified = await whoami(existing);
  return verified.status === "unauthorized" ? undefined : "saved";
}

/**
 * Run the device-code login flow interactively. Writes the user prompt,
 * polls the Taskless auth endpoint, persists the token on success, and
 * returns a tagged result the caller can surface however it wants.
 *
 * The login is recorded in `.taskless/.auth-pending.json` while it waits,
 * like a `--json` step login, so that `auth logout` or a login that replaces
 * it cancels it: once the record is gone or names another code, this flow
 * saves no token, even one the user approves afterwards.
 *
 * Does NOT emit telemetry — the caller (the `auth login` command) is
 * responsible for its own telemetry events so the events stay scoped to
 * their originating flow.
 */
export async function loginInteractive(
  options: LoginInteractiveOptions = {}
): Promise<LoginResult> {
  const cwd = options.cwd ?? process.cwd();
  const out = options.out ?? ((line) => console.log(line));
  const error_ = options.err ?? ((line) => console.error(line));
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const source = await existingLoginSource(cwd);
  if (source !== undefined) return { status: "already_logged_in", source };

  /** The device code this flow recorded as pending, once it has one. */
  let ownDeviceCode: string | undefined;
  try {
    let repositoryUrl: string | undefined;
    try {
      repositoryUrl = await resolveRepositoryUrl(cwd);
    } catch {
      // No repository or no origin — proceed without hint
    }

    const deviceCode =
      await deviceFlowProvider.requestDeviceCode(repositoryUrl);
    const verificationUrl =
      deviceCode.verification_uri_complete ?? deviceCode.verification_uri;
    const expiresAt = now() + deviceCode.expires_in * 1000;

    // Recorded so that `auth logout`, or a login that replaces this one, can
    // cancel it while it waits. It replaces any login already pending.
    await savePendingLogin(cwd, {
      deviceCode: deviceCode.device_code,
      userCode: deviceCode.user_code,
      verificationUrl,
      interval: deviceCode.interval,
      expiresAt,
      mode: "interactive",
    });
    ownDeviceCode = deviceCode.device_code;

    out("");
    out("Open this URL in your browser:");
    out("");
    out(`  ${verificationUrl}`);
    out("");
    out(`Enter code: ${deviceCode.user_code}`);
    out("");
    out("Waiting for authorization...");

    let currentInterval = deviceCode.interval * 1000;

    while (now() < expiresAt) {
      await sleep(currentInterval);

      const result = await deviceFlowProvider.pollForToken(
        deviceCode.device_code
      );
      // Checked before acting on any result, so a login cancelled while it
      // waited never saves a token, even one the user has just approved.
      if (!(await isPendingLogin(cwd, deviceCode.device_code))) {
        return { status: "cancelled", reason: "cancelled" };
      }

      switch (result.status) {
        case "success": {
          await saveToken(result.token, cwd);
          out("Logged in successfully.");
          return { status: "ok" };
        }
        case "slow_down": {
          currentInterval += 5000;
          break;
        }
        case "expired": {
          error_("Device code expired. Please try again.");
          return { status: "cancelled", reason: "expired" };
        }
        case "denied": {
          error_("Authorization denied.");
          return { status: "cancelled", reason: "denied" };
        }
        case "pending": {
          break;
        }
      }
    }

    error_("Device code expired. Please try again.");
    return { status: "cancelled", reason: "expired" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Authentication failed.";
    error_(message);
    return { status: "cancelled", reason: "error", message };
  } finally {
    // However this flow ends, its pending login is finished. A login that
    // replaced it is not this flow's to clear.
    if (ownDeviceCode !== undefined) {
      await clearOwnPendingLogin(cwd, ownDeviceCode);
    }
  }
}
