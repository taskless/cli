/**
 * Every top-level subcommand the CLI dispatches, as a reader would type it.
 *
 * This is the single source of truth for the *names*. `src/index.ts` builds its
 * `subCommands` record against it with `satisfies`, so a command added or
 * removed there without a matching entry here is a type error rather than a
 * silent drift — and tests that reason about invocations (see
 * `test/recipe-cross-references.test.ts`) read the same list instead of
 * restating it. It deliberately imports nothing: a consumer that only needs the
 * names must not have to load the whole command tree to get them.
 */
export const SUBCOMMAND_NAMES = [
  "agent",
  "auth",
  "check",
  "demo",
  "detect",
  "info",
  "init",
  "onboard",
  "rule",
  "test",
  "update",
  "verify",
] as const;

export type SubcommandName = (typeof SUBCOMMAND_NAMES)[number];
