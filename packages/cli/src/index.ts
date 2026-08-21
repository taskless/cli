import { defineCommand, runCommand, showUsage } from "citty";

import { createAgentCommand } from "./commands/agent";
import { authCommand } from "./commands/auth";
import { checkCommand } from "./commands/check";
import { detectCommand } from "./commands/detect";
import { initCommand, updateCommand } from "./commands/init";
import { testCommand, verifyCommand } from "./commands/verify";
import { infoCommand } from "./commands/info";
import { onboardCommand } from "./commands/onboard";
import { ruleCommand } from "./commands/rules";
import {
  getTelemetry,
  resolveRunIdentity,
  shutdownTelemetry,
} from "./telemetry";
import { emitRunEvents, resolveCommandName, resolveCwd } from "./telemetry-run";
import { DIR_FLAGS, hasHelpFlag, splitRawArguments } from "./util/argv";
import { showResolvedUsage } from "./util/help";
import { CLIError } from "./util/cli-error";

const subCommands = {
  init: initCommand,
  update: updateCommand,
  info: infoCommand,
  detect: detectCommand,
  check: checkCommand,
  auth: authCommand,
  onboard: onboardCommand,
  rule: ruleCommand,
  verify: verifyCommand,
  test: testCommand,
};

const agentCommand = createAgentCommand(subCommands);

const main = defineCommand({
  meta: {
    name: "taskless",
    version: __VERSION__,
    description: "Taskless CLI",
  },
  args: {
    dir: {
      type: "string",
      alias: "d",
      description: "Set the working directory",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
    "allow-version-mismatches": {
      type: "boolean",
      description:
        "Proceed when .taskless/ is newer than this CLI understands (skips migrations)",
      default: false,
    },
  },
  subCommands: {
    ...subCommands,
    agent: agentCommand,
  },
  async run({ rawArgs, cmd }) {
    // citty always calls the parent's run handler, even after a subcommand.
    // Only take action when no positional args (i.e. no subcommand) were
    // provided. A value following `-d`/`--dir` is a flag value, not a
    // positional, so splitRawArguments skips it.
    const { positionals, flags } = splitRawArguments(rawArgs);
    if (positionals.length > 0) {
      return;
    }

    // Only delegate to `init` when the only flags present are ones init
    // also understands (`-d` / `--dir`). Version/json flags, a bare `--`, and
    // any unknown flags should fall through to citty's default help instead of
    // silently launching the wizard. (`--help`/`-h` never reach here — they
    // are intercepted before dispatch below.)
    const onlyInitFlags = flags.every((flag) => DIR_FLAGS.has(flag));
    if (!onlyInitFlags) {
      await showUsage(cmd);
      return;
    }

    // TTY → run the interactive wizard. Non-TTY → print a short preamble
    // explaining the context and then delegate to `agent` so agents and
    // pipes see the topic index.
    if (process.stdout.isTTY === true && process.stdin.isTTY === true) {
      await runCommand(initCommand, { rawArgs });
      return;
    }

    console.error(
      "Taskless CLI — non-interactive context detected.\n" +
        "  For interactive install, run from a terminal.\n" +
        "  For scripted install, run `taskless init --no-interactive`.\n" +
        "  For agent recipes, run `taskless agent` (no args) for the topic index.\n"
    );
    // Forward the parent's rawArgs (e.g. `-d <path>`) so the agent command
    // doesn't mis-parse them as positional topic names.
    await runCommand(agentCommand, { rawArgs: ["agent", ...rawArgs] });
  },
});

// main loop to run cli and make every attempt to shut down gracefully
const rawArguments = process.argv.slice(2);
const runCwd = resolveCwd(rawArguments);
const startedAt = Date.now();
// Resolve identity at invocation START so cli_run reports who *initiated* the
// run, not the post-command state — e.g. `auth login` run by a logged-out user
// reports loggedIn:false (the login was performed as a logged-out user).
const startIdentity = await resolveRunIdentity(runCwd);
let thrown: unknown;
try {
  // Help is intercepted here, before dispatch, because citty implements
  // `--help` only in runMain — and runMain exits the process on both its help
  // and error paths, which would skip the `finally` below and drop the cli_run
  // denominator. Rendering here returns normally instead.
  await (hasHelpFlag(rawArguments)
    ? showResolvedUsage(main, rawArguments)
    : runCommand(main, { rawArgs: rawArguments }));
} catch (error) {
  // CLIError = expected failure. Most throw sites (the `fail()` helpers) print
  // and set exitCode first and mark themselves `reported`; one that does not
  // still has to produce output and a non-zero exit, or the CLI exits 0 with no
  // message and the failure reads as success.
  thrown = error;
  if (error instanceof CLIError) {
    if (!error.reported) {
      console.error(`Error: ${error.message}`);
    }
    if (!process.exitCode) process.exitCode = 1;
  } else {
    process.exitCode = 1;
    console.error(error instanceof Error ? error.message : String(error));
  }
} finally {
  // cli_run is the per-invocation denominator: emitted exactly once here, on
  // both success and failure, so no command has to remember to. Telemetry is
  // best-effort and never affects the exit.
  try {
    const telemetry = await getTelemetry(runCwd);
    const success =
      thrown === undefined &&
      (process.exitCode === undefined || process.exitCode === 0);
    emitRunEvents(telemetry, {
      command: resolveCommandName(rawArguments),
      success,
      durationMs: Date.now() - startedAt,
      anonymous: startIdentity.anonymous,
      loggedIn: startIdentity.loggedIn,
      error: thrown,
    });
  } catch {
    // Telemetry failures are silent
  }
  try {
    await shutdownTelemetry();
  } catch {
    //
  }
}
