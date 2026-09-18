import process from "node:process";

import { deviceFlowProvider } from "./device-flow";
import { getToken, saveToken } from "./token";
import { resolveRepositoryUrl } from "../util/git-remote";

export type LoginResult =
  | { status: "ok" }
  | { status: "already_logged_in" }
  | {
      status: "cancelled";
      reason: "expired" | "denied" | "error";
      message?: string;
    };

export interface LoginInteractiveOptions {
  cwd?: string;
  /** Sink for user-facing progress lines. Defaults to console.log. */
  out?: (line: string) => void;
  /** Sink for error lines. Defaults to console.error. */
  err?: (line: string) => void;
}

/**
 * Run the device-code login flow interactively. Writes the user prompt,
 * polls the Taskless auth endpoint, persists the token on success, and
 * returns a tagged result the caller can surface however it wants.
 *
 * Does NOT emit telemetry — the caller (wizard or `auth login` command) is
 * responsible for its own telemetry events so the events stay scoped to
 * their originating flow.
 */
export async function loginInteractive(
  options: LoginInteractiveOptions = {}
): Promise<LoginResult> {
  const cwd = options.cwd ?? process.cwd();
  const out = options.out ?? ((line) => console.log(line));
  const error_ = options.err ?? ((line) => console.error(line));

  // Silent: we're inside an interactive (clack) flow — stderr warnings from
  // legacy/tracked-token checks would corrupt the UI. Pre-checks happen in
  // promptAuth() before we get here.
  const existing = await getToken(cwd, { silent: true });
  if (existing) {
    return { status: "already_logged_in" };
  }

  try {
    let repositoryUrl: string | undefined;
    try {
      repositoryUrl = await resolveRepositoryUrl(cwd);
    } catch {
      // Not a git repo or no origin — proceed without hint
    }

    const deviceCode =
      await deviceFlowProvider.requestDeviceCode(repositoryUrl);

    out("");
    out("Open this URL in your browser:");
    out("");
    out(
      `  ${deviceCode.verification_uri_complete ?? deviceCode.verification_uri}`
    );
    out("");
    out(`Enter code: ${deviceCode.user_code}`);
    out("");
    out("Waiting for authorization...");

    const intervalMs = deviceCode.interval * 1000;
    const expiresAt = Date.now() + deviceCode.expires_in * 1000;
    let currentInterval = intervalMs;

    while (Date.now() < expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, currentInterval));

      const result = await deviceFlowProvider.pollForToken(
        deviceCode.device_code
      );

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
  }
}
