/**
 * Whether a set of positional paths means "walk the whole project".
 *
 * Both static engines apply their CLI-managed-directory exclusions only on a
 * whole-project walk, because an explicit path is a request: silently declining
 * to check a file someone named would be worse than checking one they did not.
 * That rule needs a correct answer to "did we choose this, or did the user?",
 * and both engines were getting it from `paths.length === 0`.
 *
 * **That test is wrong for `.`, and the mistake is silent.** `filterExistingPaths`
 * (`commands/check.ts`) normalizes a positional path resolving to cwd into the
 * literal string `"."` rather than dropping back to an empty array, so
 * `taskless check .` — a near-default invocation — arrives with `paths = ["."]`.
 * Under a length test that reads as a user request and skips the exclusions,
 * which is how `check .` came to report findings inside `.taskless/` while a
 * bare `check` did not.
 *
 * A single explicit `.` is a request for the project, not for the CLI's own
 * config inside it, so it is a whole-project walk. A path *under* `.taskless/`
 * is still honored: that names the config directly.
 *
 * Shared rather than duplicated because the two engines diverging here is
 * exactly the class of bug this fixes — one of them was already wrong in the
 * same way.
 */
export function isWholeProjectWalk(paths: string[]): boolean {
  if (paths.length === 0) return true;
  return paths.length === 1 && CWD_ALIASES.has(paths[0] ?? "");
}

/**
 * Spellings of "here" that `filterExistingPaths` can emit or a shell can pass.
 * `"."` is what the normalizer produces; the others reach us straight from argv.
 */
const CWD_ALIASES = new Set([".", "./", ".\\"]);
