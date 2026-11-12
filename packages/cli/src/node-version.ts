/**
 * The Node version check the package's `bin` runs before it loads the CLI.
 *
 * It lives apart from the CLI because the CLI cannot run it: on an older Node
 * the CLI's module graph fails to link (`globSync` from `node:fs`, for one)
 * before any of its code executes, so a check inside it never gets the chance
 * to speak. This module and the shim that calls it (`src/bin.ts`) import
 * nothing that an old Node lacks.
 *
 * The project launcher (`assets/launcher/launcher.mjs`) carries its own copy
 * of the same comparison and prints the same message. It is a standalone
 * script written into a project, so it cannot import this one.
 */

/** `>=MAJOR[.MINOR[.PATCH]]`, the only `engines.node` shape this package uses. */
const MINIMUM = /^\s*>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/;

/** The numeric `[major, minor, patch]` of a version, ignoring any prerelease. */
function parts(version: string): number[] | undefined {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
  if (match === null) return undefined;
  return [match[1], match[2], match[3]].map((part) => Number(part ?? 0));
}

/**
 * The message to print when `running` does not satisfy `required`, or
 * undefined when it does.
 *
 * Only a `>=` lower bound is understood. Any other range, or none, passes:
 * a check that cannot read the requirement must not be the thing that stops
 * the CLI from running.
 */
export function nodeVersionProblem(
  required: string | null | undefined,
  running: string
): string | undefined {
  if (typeof required !== "string") return undefined;
  const match = MINIMUM.exec(required);
  const have = parts(running);
  if (match === null || have === undefined) return undefined;
  const need = [match[1], match[2], match[3]].map((part) => Number(part ?? 0));
  for (const [index, wanted] of need.entries()) {
    const actual = have[index] ?? 0;
    if (actual > wanted) return undefined;
    if (actual < wanted) {
      return (
        `Taskless needs Node ${required.trim()}, you have ${running}. ` +
        `Install a newer Node and run it again.`
      );
    }
  }
  return undefined;
}
