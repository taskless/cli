import { resolve } from "node:path";
import process from "node:process";
import { defineCommand } from "citty";

import { whoami } from "../api/v2";
import { loginInteractive } from "../auth/login-interactive";
import {
  getToken,
  isEnvironmentToken,
  rejectedTokenRemedy,
  removeToken,
} from "../auth/token";
import { getTelemetry } from "../telemetry";
import { type CLIErrorCode, writeJsonError } from "../types/errors";
import { splitRawArguments } from "../util/argv";
import { getCliPrefix } from "../util/package-manager";

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
        "On error, write the standardized { ok:false, code, message } envelope to stdout instead of human text on stderr",
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
      // In --json mode the user is an agent / pipe; suppress the device-flow
      // chatter and only emit a single structured line on error.
      const noop = (): void => {};
      const result = await loginInteractive(
        args.json ? { cwd, out: noop, err: noop } : { cwd }
      );

      switch (result.status) {
        case "ok": {
          authenticated = true;
          return;
        }
        case "already_logged_in": {
          if (!args.json) {
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
          }
          return;
        }
        case "cancelled": {
          const code: CLIErrorCode =
            result.reason === "denied" ? "AUTH_REQUIRED" : "NETWORK_ERROR";
          const message =
            result.message ??
            (result.reason === "denied"
              ? "Authorization denied."
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
        telemetry.capture("cli_authenticated");
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

    const source = isEnvironmentToken() ? " via TASKLESS_TOKEN" : "";
    const outcome = await whoami(token);
    switch (outcome.status) {
      case "ok": {
        const orgs = outcome.data.orgs.map((o) => o.name);
        const orgSuffix = orgs.length > 0 ? ` (${orgs.join(", ")})` : "";
        console.log(`Logged in as ${outcome.data.user}${orgSuffix}${source}.`);
        return;
      }
      case "unauthorized": {
        console.log(`Logged in${source}, but the token was rejected.`);
        console.log(`It is invalid or expired. ${rejectedTokenRemedy()}`);
        return;
      }
      default: {
        console.log(`Logged in${source}, but unable to verify identity.`);
        if (outcome.status === "unavailable") {
          console.log(
            `The Taskless service was unreachable (${outcome.reason}).`
          );
        }
      }
    }
  },
});
