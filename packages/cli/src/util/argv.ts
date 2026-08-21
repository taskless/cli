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
      if (
        consumesValue.has(argument) &&
        rawArguments[index + 1] !== undefined &&
        rawArguments[index + 1] !== END_OF_OPTIONS
      ) {
        index++;
      }
      continue;
    }
    positionals.push(argument);
  }
  return { positionals, flags };
}

/**
 * True when argv asks for help. Scanned through `splitRawArguments` so neither
 * a flag value nor a path after `--` that happens to read like `-h` is mistaken
 * for a help request.
 */
export function hasHelpFlag(rawArguments: string[]): boolean {
  const { flags } = splitRawArguments(rawArguments);
  return flags.includes("--help") || flags.includes("-h");
}
