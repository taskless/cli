/**
 * Raw-argv scanning shared by everything that has to answer "which tokens are
 * positionals?" — subcommand resolution for `--help`, the root command's
 * no-subcommand check, and telemetry's command name. One copy, because the
 * rule is subtle: `-d`/`--dir` take a value, so the token after one of them is
 * a flag value and NOT a positional (`taskless -d /tmp check` runs `check`,
 * not `/tmp`).
 */

/** Flags that consume the following token as their value. */
const VALUE_FLAGS = new Set(["-d", "--dir"]);

export interface SplitArguments {
  /** Tokens that are not flags and not the value of a value-taking flag. */
  positionals: string[];
  /** Tokens that start with `-`. Values consumed by them are not included. */
  flags: string[];
}

/** Split raw argv into positionals and flags, skipping flag values. */
export function splitRawArguments(rawArguments: string[]): SplitArguments {
  const positionals: string[] = [];
  const flags: string[] = [];
  for (let index = 0; index < rawArguments.length; index++) {
    const argument = rawArguments[index]!;
    if (argument.startsWith("-")) {
      flags.push(argument);
      // `--dir=<path>` carries its own value; `-d <path>` eats the next token.
      if (VALUE_FLAGS.has(argument)) index++;
      continue;
    }
    positionals.push(argument);
  }
  return { positionals, flags };
}

/**
 * True when argv asks for help. Scanned through `splitRawArguments` so a flag value
 * that happens to read like `-h` is not mistaken for a help request.
 */
export function hasHelpFlag(rawArguments: string[]): boolean {
  const { flags } = splitRawArguments(rawArguments);
  return flags.includes("--help") || flags.includes("-h");
}
