import { showUsage } from "citty";
import type { ArgsDef, CommandDef, Resolvable } from "citty";

import { splitRawArguments } from "./argv";

/**
 * citty only implements `--help` inside `runMain`, and `runMain`'s help path
 * calls `process.exit(0)` — which skips `finally` blocks, including the one in
 * `src/index.ts` that emits the `cli_run` telemetry denominator. So the CLI
 * keeps `runCommand` and resolves help itself, here, using citty's own
 * exported `showUsage` so no usage text is hand-written.
 *
 * citty's `resolveSubCommand` is not exported, and its own walk would resolve
 * `taskless -d /tmp check --help` to `/tmp` (it takes the first non-`-` token),
 * so the walk below uses the shared argv scanner instead.
 */

/** Resolve a citty `Resolvable<T>` (value, promise, or factory) to its value. */
async function resolveValue<T>(
  value: Resolvable<T> | undefined
): Promise<T | undefined> {
  return typeof value === "function"
    ? await (value as () => T | Promise<T>)()
    : await value;
}

/**
 * Render usage for the deepest command the positionals resolve to, with its
 * parent (so nested commands like `auth login` print their own usage under
 * their own name). Returns normally — never exits — so the caller's telemetry
 * `finally` still runs.
 */
export async function showResolvedUsage<T extends ArgsDef = ArgsDef>(
  root: CommandDef<T>,
  rawArguments: string[]
): Promise<void> {
  // Widen once: the walk descends into subcommands, each with its own args
  // shape, and only the rendering (which reads meta and args generically) is
  // done with the result.
  let command = root as unknown as CommandDef;
  let parent: CommandDef | undefined;

  for (const name of splitRawArguments(rawArguments).positionals) {
    const subCommands = await resolveValue(command.subCommands);
    const child = subCommands
      ? await resolveValue(subCommands[name])
      : undefined;
    // The first token that is not a child of the current command ends the
    // walk (it is a positional argument, or a typo) — render what resolved.
    if (!child) break;
    parent = command;
    command = child;
  }

  await showUsage(command, parent);
}
