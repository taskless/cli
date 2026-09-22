/**
 * Raw-argv scanning shared by everything that has to answer "which tokens are
 * positionals?" — subcommand resolution for `--help`, the root command's
 * no-subcommand check, `check`'s path arguments, and telemetry's command name.
 * One copy, because the rules are subtle:
 *
 * - `-d`/`--dir` take a value, so the token after one of them is a flag value
 *   and NOT a positional (`taskless -d /tmp check` runs `check`, not `/tmp`).
 * - `--` is the POSIX end-of-options marker: every token after it is a
 *   positional even if it starts with `-`, which is what lets `taskless check
 *   -- -h` scan a path literally named `-h` instead of asking for help.
 */

/** Flags every command takes a value for. */
export const DIR_FLAGS = new Set(["-d", "--dir"]);

/** The POSIX end-of-options marker. */
const END_OF_OPTIONS = "--";

export interface SplitArguments {
  /**
   * Tokens that are not flags and not the value of a value-taking flag, plus
   * everything after `--`.
   */
  positionals: string[];
  /**
   * Option tokens, in order, including the `--` marker itself. Values consumed
   * by a value-taking flag are not included.
   */
  flags: string[];
  /**
   * Every value a value-taking flag carried, in order, in both spellings
   * (`--flag value` and `--flag=value`).
   *
   * Here rather than in each caller because a second scanner is a second
   * opinion about what the same tokens mean. `check` needs every `--rule`
   * value, and a hand-rolled scan of its own would not know that `--timeout`
   * consumes the token after it: `check --timeout --rule no-eval` would give
   * `no-eval` to `--rule` while this scanner had already handed it to
   * `positionals`. Reading both answers off one pass makes that disagreement
   * impossible rather than unlikely.
   */
  values: FlagValue[];
}

/** One occurrence of a value-taking flag, with the value it consumed. */
export interface FlagValue {
  /** The flag as written, without any `=value` suffix. */
  flag: string;
  value: string;
}

/**
 * Split raw argv into positionals and flags, skipping flag values and honoring
 * `--`. `valueFlags` names flags beyond `-d`/`--dir` that consume the next
 * token (e.g. `check`'s `--timeout`).
 */
export function splitRawArguments(
  rawArguments: string[],
  valueFlags: readonly string[] = []
): SplitArguments {
  const consumesValue =
    valueFlags.length > 0 ? new Set([...DIR_FLAGS, ...valueFlags]) : DIR_FLAGS;
  const positionals: string[] = [];
  const flags: string[] = [];
  const values: FlagValue[] = [];
  for (let index = 0; index < rawArguments.length; index++) {
    const argument = rawArguments[index]!;
    if (argument === END_OF_OPTIONS) {
      flags.push(argument);
      positionals.push(...rawArguments.slice(index + 1));
      break;
    }
    if (argument.startsWith("-")) {
      flags.push(argument);
      // `--dir=<path>` carries its own value; `-d <path>` eats the next token —
      // unless that token is `--`, which ends the options rather than being one.
      const equals = argument.indexOf("=");
      if (equals > 0) {
        const flag = argument.slice(0, equals);
        if (consumesValue.has(flag))
          values.push({ flag, value: argument.slice(equals + 1) });
        continue;
      }
      if (
        consumesValue.has(argument) &&
        rawArguments[index + 1] !== undefined &&
        rawArguments[index + 1] !== END_OF_OPTIONS
      ) {
        values.push({ flag: argument, value: rawArguments[index + 1]! });
        index++;
      }
      continue;
    }
    positionals.push(argument);
  }
  return { positionals, flags, values };
}

/**
 * True when any of `names` appears as a flag token. Scanned through
 * `splitRawArguments` so neither a flag value nor a path after `--` that
 * happens to read like `-h` or `-v` is mistaken for a request. Matched as
 * whole tokens, the same way citty's own `runMain` matches `--help` and
 * `--version`.
 */
function hasFlag(rawArguments: string[], names: readonly string[]): boolean {
  const { flags } = splitRawArguments(rawArguments);
  return names.some((name) => flags.includes(name));
}

/** True when argv asks for help. */
export function hasHelpFlag(rawArguments: string[]): boolean {
  return hasFlag(rawArguments, ["--help", "-h"]);
}

/**
 * True when argv asks for the version. Position is not consulted, so
 * `taskless check --version` answers with the version too — the question is
 * about the tool, not the subcommand, and no subcommand defines `-v` or
 * `--version` itself.
 */
export function hasVersionFlag(rawArguments: string[]): boolean {
  return hasFlag(rawArguments, ["--version", "-v"]);
}
