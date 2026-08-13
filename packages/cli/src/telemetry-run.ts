import { resolve } from "node:path";

import type { TelemetryClient } from "./telemetry";
import { CLIError } from "./util/cli-error";

/**
 * Derive the cli_run `command` property from the raw argv. Flags (and the
 * value after `-d`/`--dir`) are skipped; the first positional is the command,
 * and `rule` keeps its subcommand (e.g. `rule create`) since that distinction
 * is meaningful. `agent`'s topic is recorded separately on cli_help, so the
 * command for an agent invocation is just `agent`.
 */
export function resolveCommandName(rawArguments: string[]): string {
  const valueFlags = new Set(["-d", "--dir"]);
  const positionals: string[] = [];
  for (let index = 0; index < rawArguments.length; index++) {
    const argument = rawArguments[index]!;
    if (argument.startsWith("-")) {
      if (!argument.includes("=") && valueFlags.has(argument)) index++;
      continue;
    }
    positionals.push(argument);
  }

  if (positionals.length === 0) return "(default)";
  const top = positionals[0]!;
  if (top === "rule" && positionals[1]) return `rule ${positionals[1]}`;
  return top;
}

/** Resolve the working directory from `-d`/`--dir`, defaulting to cwd. */
export function resolveCwd(rawArguments: string[]): string {
  for (let index = 0; index < rawArguments.length; index++) {
    const argument = rawArguments[index]!;
    if (
      (argument === "-d" || argument === "--dir") &&
      rawArguments[index + 1]
    ) {
      return resolve(rawArguments[index + 1]!);
    }
    if (argument.startsWith("--dir=")) {
      return resolve(argument.slice("--dir=".length));
    }
  }
  return process.cwd();
}

export interface RunContext {
  command: string;
  success: boolean;
  durationMs: number;
  /** Resolved fresh at emission time (see resolveRunIdentity) so auth-changing
   * commands report post-invocation state. */
  anonymous: boolean;
  loggedIn: boolean;
  /** The thrown error, if the command threw. */
  error?: unknown;
}

/**
 * Emit the per-invocation telemetry: a single `cli_run` denominator event
 * (always), preceded by `cli_error` only when the command threw. The CLI
 * version is NOT added here — it rides on the standard `cliVersion` property
 * the telemetry client attaches to every event.
 */
export function emitRunEvents(
  telemetry: Pick<TelemetryClient, "capture">,
  context: RunContext
): void {
  // cli_error fires only for a thrown failure (with a known CLIErrorCode when
  // available). A failure signalled purely via process.exitCode (the command
  // printed its own error) is captured by cli_run's success:false — emitting
  // cli_error there would mislabel it INTERNAL_ERROR.
  if (context.error !== undefined) {
    const code =
      context.error instanceof CLIError && context.error.code
        ? context.error.code
        : "INTERNAL_ERROR";
    telemetry.capture("cli_error", { command: context.command, code });
  }

  telemetry.capture("cli_run", {
    command: context.command,
    success: context.success,
    durationMs: context.durationMs,
    anonymous: context.anonymous,
    loggedIn: context.loggedIn,
  });
}
