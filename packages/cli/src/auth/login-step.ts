import { deviceFlowProvider } from "./device-flow";
import { existingLoginSource } from "./login-interactive";
import {
  clearPendingLogin,
  type PendingLogin,
  readPendingLogin,
  savePendingLogin,
} from "./pending-login";
import { saveToken } from "./token";
import { resolveRepositoryUrl } from "../util/git-remote";

/**
 * The longest one step waits for approval. Well under the two-minute default
 * a Claude Code Bash call allows, so a step returns before an agent's tool
 * gives up on it. Lowering it costs only more calls.
 */
export const LOGIN_STEP_WAIT_MS = 45_000;

/** How much the service asks a poller to back off on `slow_down`. */
const SLOW_DOWN_MS = 5000;

export type LoginStepResult =
  | { status: "already_logged_in"; source: "environment" | "saved" }
  | { status: "authenticated" }
  | {
      status: "pending";
      verificationUrl: string;
      userCode: string;
      expiresAt: number;
    }
  | {
      status: "failed";
      /**
       * `cancelled`: the pending login this step was polling was removed
       * (by `auth logout`) or replaced (by another login) while it waited.
       */
      reason: "denied" | "expired" | "cancelled" | "error";
      message?: string;
    };

export interface LoginStepOptions {
  cwd: string;
  /** Defaults to {@link LOGIN_STEP_WAIT_MS}. */
  waitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function pendingResult(pending: PendingLogin): LoginStepResult {
  return {
    status: "pending",
    verificationUrl: pending.verificationUrl,
    userCode: pending.userCode,
    expiresAt: pending.expiresAt,
  };
}

/**
 * One bounded step of a device-code login, for a caller that only sees a
 * command's output once it exits.
 *
 * The first step starts a login and returns its URL at once. Each later step
 * polls the saved login for at most {@link LOGIN_STEP_WAIT_MS} and reports
 * where it got to, so a caller repeats the step until it is not `pending`.
 * Every `pending` result carries the URL and code, so a caller that lost
 * track can always show the right ones.
 */
export async function loginStep(
  options: LoginStepOptions
): Promise<LoginStepResult> {
  const { cwd } = options;
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const waitMs = options.waitMs ?? LOGIN_STEP_WAIT_MS;

  try {
    const source = await existingLoginSource(cwd);
    if (source !== undefined) return { status: "already_logged_in", source };

    const saved = await readPendingLogin(cwd);
    // A code that expired before this step began belongs to a login this
    // caller may never have seen, so it is replaced rather than reported.
    if (saved === undefined || saved.expiresAt <= now()) {
      return pendingResult(await startLogin(cwd, now()));
    }

    const pending = saved;
    const deadline = now() + waitMs;
    let interval = pending.interval * 1000;
    /**
     * Whether the saved pending login is still the one this step polls.
     * `auth logout` clears it, and a later `auth login --json` may replace
     * it, while this step sleeps on the copy it read. Checked after every
     * poll and before every write, so a cancelled login never saves a token
     * and is never written back. The gap between this read and the write
     * that follows it is a few milliseconds, and is accepted.
     */
    const stillPending = async (): Promise<boolean> => {
      const current = await readPendingLogin(cwd);
      return current?.deviceCode === pending.deviceCode;
    };
    const cancelled: LoginStepResult = {
      status: "failed",
      reason: "cancelled",
    };

    // Poll only while a wait still fits, so a step ends within its window.
    // The wait is the service's interval, capped at the window: an interval
    // longer than the window would otherwise never fit, and every step would
    // return without polling once, until the code expired. The saved
    // interval keeps the service's value, so a slow_down is never lost.
    const wait = (): number => Math.min(interval, waitMs);
    while (now() + wait() <= Math.min(deadline, pending.expiresAt)) {
      await sleep(wait());
      const result = await deviceFlowProvider.pollForToken(pending.deviceCode);
      if (!(await stillPending())) return cancelled;
      switch (result.status) {
        case "success": {
          await saveToken(result.token, cwd);
          await clearPendingLogin(cwd);
          return { status: "authenticated" };
        }
        case "denied": {
          await clearPendingLogin(cwd);
          return { status: "failed", reason: "denied" };
        }
        case "expired": {
          await clearPendingLogin(cwd);
          return { status: "failed", reason: "expired" };
        }
        case "slow_down": {
          interval += SLOW_DOWN_MS;
          // Kept for the next step, which would otherwise poll too fast.
          await savePendingLogin(cwd, {
            ...pending,
            interval: interval / 1000,
          });
          break;
        }
        case "pending": {
          break;
        }
      }
    }

    // Expiry, not the wait, ended the polling: the code runs out inside this
    // step's window. Wait it out so the report is never early, then say so to
    // the caller that was waiting on it. A code that outlives the window is
    // still pending, and the step that reaches its expiry reports it.
    if (pending.expiresAt <= deadline) {
      await sleep(Math.max(0, pending.expiresAt - now()));
      // A login that replaced this one while it waited is not this one's to clear.
      if (!(await stillPending())) return cancelled;
      await clearPendingLogin(cwd);
      return { status: "failed", reason: "expired" };
    }
    return pendingResult(pending);
  } catch (error) {
    // The pending login is kept: a failed request says nothing about it.
    return {
      status: "failed",
      reason: "error",
      message:
        error instanceof Error ? error.message : "Authentication failed.",
    };
  }
}

async function startLogin(
  cwd: string,
  startedAt: number
): Promise<PendingLogin> {
  let repositoryUrl: string | undefined;
  try {
    repositoryUrl = await resolveRepositoryUrl(cwd);
  } catch {
    // Not a git repo or no origin — proceed without hint
  }
  const deviceCode = await deviceFlowProvider.requestDeviceCode(repositoryUrl);
  const pending: PendingLogin = {
    deviceCode: deviceCode.device_code,
    userCode: deviceCode.user_code,
    verificationUrl:
      deviceCode.verification_uri_complete ?? deviceCode.verification_uri,
    interval: deviceCode.interval,
    expiresAt: startedAt + deviceCode.expires_in * 1000,
  };
  await savePendingLogin(cwd, pending);
  return pending;
}
