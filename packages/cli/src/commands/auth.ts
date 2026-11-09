import { resolve } from "node:path";
import process from "node:process";
import { defineCommand } from "citty";

import { whoami } from "../api/v2";
import { loginInteractive } from "../auth/login-interactive";
import { loginStep } from "../auth/login-step";
import { clearPendingLogin } from "../auth/pending-login";
import { describeAuthStatus } from "../auth/status";
import { getToken, isEnvironmentToken, removeToken } from "../auth/token";
import { getTelemetry, type TelemetryClient } from "../telemetry";
import { type CLIErrorCode, writeJsonError } from "../types/errors";
import { splitRawArguments } from "../util/argv";
import { getCliPrefix } from "../util/package-manager";

type FailedLoginStep = Extract<
  Awaited<ReturnType<typeof loginStep>>,
  { status: "failed" }
>;

/**
 * A cancelled login is AUTH_REQUIRED, like a denial: the repository is not
 * logged in, nothing about the network failed, and the remedy is a new
 * `auth login`. It is not AUTH_EXPIRED, which says the code ran out, and an
 * agent must not read it as NETWORK_ERROR and retry the login the user just
 * logged out of.
 */
function loginStepErrorCode(reason: FailedLoginStep["reason"]): CLIErrorCode {
  switch (reason) {
    case "denied":
    case "cancelled": {
      return "AUTH_REQUIRED";
    }
    case "expired": {
      return "AUTH_EXPIRED";
    }
    case "error": {
      return "NETWORK_ERROR";
    }
  }
}

/**
 * Why a login saved no token though it was waiting on one, for the interactive
 * flow and the `--json` step alike. `rerun` is the command that starts anew.
 */
function cancelledLoginMessage(rerun: string): string {
  return `The login was cancelled: \`auth logout\` ran, or another login replaced it, while this one waited. Run \`${rerun}\` again to start a new one.`;
}

function loginStepMessage(step: FailedLoginStep): string {
  if (step.message !== undefined) return step.message;
  switch (step.reason) {
    case "denied": {
      return "Authorization denied.";
    }
    case "cancelled": {
      return cancelledLoginMessage("auth login --json");
    }
    case "expired": {
      return "The login code expired before it was approved. Run `auth login --json` again for a new one.";
    }
    case "error": {
      return "Authentication failed.";
    }
  }
}

/**
 * Capture `cli_authenticated` under the identity just logged in. The client
 * was built before the login, under the anonymous id, in the interactive
 * process and in the `--json` step process alike, so it switches to the
 * saved token's identity first: the event that marks a login is the one
 * that must carry the user and their org.
 */
async function captureAuthenticated(
  telemetry: TelemetryClient,
  cwd: string
): Promise<void> {
  const token = await getToken(cwd, { silent: true });
  if (token !== undefined) telemetry.identifyAuthenticated(token);
  telemetry.capture("cli_authenticated");
}

const loginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Authenticate with taskless.io",
  },
  args: {
    dir: {
      type: "string",
      alias: "d",
      description: "Working directory",
    },
    anonymous: {
      type: "boolean",
      description: "Rejected: auth commands cannot be anonymous",
      default: false,
    },
    json: {
      type: "boolean",
      description:
        "Run one bounded step for an agent: start a login or wait up to 45s on the pending one, then print { ok, status } (pending carries the URL and code). Repeat until status is not pending.",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());
    const telemetry = await getTelemetry(cwd);

    /** Emit an error in the right channel and set exit code. */
    const fail = (code: CLIErrorCode, message: string): void => {
      if (args.json) {
        writeJsonError(code, message);
      } else {
        console.error(`Error: ${message}`);
      }
      process.exitCode = 1;
    };

    if (args.anonymous) {
      fail("INVALID_INPUT", "auth commands cannot be anonymous.");
      return;
    }

    // Set true only when a fresh authentication completes; drives the
    // cli_authenticated event in the finally.
    let authenticated = false;
    try {
      // An agent sees a command's output only once it exits, so under
      // --json a login is a step it repeats rather than one blocking call
      // that holds back the URL its user needs.
      if (args.json) {
        const step = await loginStep({ cwd });
        switch (step.status) {
          case "already_logged_in": {
            console.log(
              JSON.stringify({
                ok: true,
                status: step.status,
                source: step.source,
              })
            );
            return;
          }
          case "authenticated": {
            authenticated = true;
            console.log(JSON.stringify({ ok: true, status: step.status }));
            return;
          }
          case "pending": {
            console.log(
              JSON.stringify({
                ok: true,
                status: step.status,
                verificationUrl: step.verificationUrl,
                userCode: step.userCode,
                expiresAt: new Date(step.expiresAt).toISOString(),
              })
            );
            return;
          }
          case "failed": {
            fail(loginStepErrorCode(step.reason), loginStepMessage(step));
            return;
          }
        }
      }

      const result = await loginInteractive({ cwd });

      switch (result.status) {
        case "ok": {
          authenticated = true;
          return;
        }
        case "already_logged_in": {
          if (result.source === "environment") {
            console.log(
              "You are already logged in with the TASKLESS_TOKEN environment variable."
            );
            console.log(
              "A saved login would not be used while it is set. Unset TASKLESS_TOKEN first to log in here."
            );
          } else {
            console.log("You are already logged in.");
            console.log(
              `Run \`${getCliPrefix()} auth logout\` first to re-authenticate.`
            );
          }
          return;
        }
        case "cancelled": {
          // A cancelled login is AUTH_REQUIRED here for the same reasons as
          // under --json: see loginStepErrorCode.
          const code: CLIErrorCode =
            result.reason === "denied" || result.reason === "cancelled"
              ? loginStepErrorCode(result.reason)
              : "NETWORK_ERROR";
          const message =
            result.message ??
            (result.reason === "denied"
              ? "Authorization denied."
              : result.reason === "cancelled"
                ? cancelledLoginMessage("auth login")
                : result.reason === "expired"
                  ? "Device code expired. Please try again."
                  : "Authentication failed.");
          fail(code, message);
          return;
        }
      }
    } finally {
      // Concrete state event: a fresh authentication succeeded.
      if (authenticated) {
        await captureAuthenticated(telemetry, cwd);
      }
    }
  },
});

const logoutCommand = defineCommand({
  meta: {
    name: "logout",
    description: "Remove saved authentication",
  },
  args: {
    dir: {
      type: "string",
      alias: "d",
      description: "Working directory",
    },
    anonymous: {
      type: "boolean",
      description: "Accepted for compatibility; logout is already local",
      default: false,
    },
    json: {
      type: "boolean",
      description:
        "On error, write the standardized { ok:false, code, message } envelope to stdout. Success is silent on stdout in --json mode.",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());
    const telemetry = await getTelemetry(cwd);

    let removed = false;
    try {
      // A login still waiting on approval would otherwise sign this
      // repository back in after the user asked to be logged out. Cleared
      // before the token is removed, so a login that saves a token between
      // the two has its token removed here rather than kept.
      await clearPendingLogin(cwd);
      removed = await removeToken(cwd);
      if (!args.json) {
        // logout only removes the saved token. Without saying so, a user
        // whose token comes from the environment reads "Not logged in." and
        // is still authenticated as before.
        const environment = isEnvironmentToken();
        console.log(
          removed
            ? "Logged out."
            : environment
              ? "No saved login to remove."
              : "Not logged in."
        );
        if (environment) {
          console.log(
            "TASKLESS_TOKEN is set in the environment and is still used. Unset it to log out."
          );
        }
      }
    } finally {
      // Concrete state event: a saved token was actually removed.
      if (removed) {
        telemetry.capture("cli_logged_out");
      }
    }
  },
});

export const authCommand = defineCommand({
  meta: {
    name: "auth",
    description: "Manage authentication with taskless.io",
  },
  args: {
    dir: {
      type: "string",
      alias: "d",
      description: "Working directory",
    },
    json: {
      type: "boolean",
      description:
        "Accepted on the status path for forward-compat; today the status output is plain text and emits no error envelope (no error paths)",
      default: false,
    },
  },
  subCommands: {
    login: loginCommand,
    logout: logoutCommand,
  },
  async run({ args, rawArgs }) {
    // citty always calls the parent's run handler, even after a subcommand.
    // Only show status when no subcommand was provided. The shared scanner
    // skips flag values, so the path in `auth -d <path>` is not read as one.
    if (splitRawArguments(rawArgs).positionals.length > 0) {
      return;
    }

    const cwd = resolve(args.dir ?? process.cwd());

    const token = await getToken(cwd);
    if (!token) {
      console.log("Not logged in.");
      console.log(`Run \`${getCliPrefix()} auth login\` to authenticate.`);
      return;
    }

    for (const line of describeAuthStatus(await whoami(token))) {
      console.log(line);
    }
  },
});
