import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { isRecord } from "../util/is-record";
import { compareVersions } from "../util/version-compare";

/**
 * Pins in `package.json` that would run a Taskless CLI older than the one that
 * just upgraded this project.
 *
 * An upgrade is usually run through a launcher (`npx @taskless/cli@latest
 * init`), which leaves the project's own pins alone: a `devDependencies` entry,
 * or a script that spells out `@taskless/cli@0.10.2`. Those are what CI, a git
 * hook, and `pnpm lint` actually run, so after the upgrade they run a CLI that
 * predates the `.taskless/` layout it now finds. An older CLI refuses a layout
 * newer than it understands, or, where the layout did not move, runs rules
 * against engines the ledger has since moved past. Nothing about the upgrade
 * itself fails, so the first sign is a red CI run on the next push.
 *
 * Detection is deliberately narrow. Only a pin whose ceiling sits below the
 * running version is reported: an exact version, or a `^`/`~` range that
 * cannot reach it. A spec this module cannot bound (`latest`, `*`, `>=`, a
 * `workspace:` or URL spec) is not reported, because "this might be old" is a
 * guess, and a notice that guesses is one an agent learns to skip.
 */

/**
 * The package names a pin may name.
 *
 * Keys looked up in someone else's `package.json`, never text this CLI emits,
 * so there is nothing for `applyCliInvocation()` to rewrite: a nightly build
 * still has to recognise a project that pins the release.
 */
// ast-grep-ignore: no-unrouted-cli-invocation
const PACKAGE_NAMES = ["@taskless/cli", "@taskless/cli-nightly"] as const;

/** The `package.json` fields a dependency pin may live in. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
] as const;

/**
 * A launcher spelling in a script: the package name, then `@` and a version.
 * The nightly name is tried first so `@taskless/cli` cannot claim its prefix.
 */
const SCRIPT_PIN = /@taskless\/(cli-nightly|cli)@([^\s"'`;&|)]+)/g;

/** `1.2.3`, optionally prefixed `^`, `~`, `=` or `v`, optionally prerelease. */
const BOUNDED_SPEC = /^([\^~]|=?v?)(\d+)\.(\d+)\.(\d+)(-[\w.-]+)?$/;

/** One pin that cannot resolve to the running CLI. */
export interface PinnedCli {
  /** Where the pin lives: `devDependencies`, or `scripts.<name>`. */
  location: string;
  /** The package the pin names. */
  name: string;
  /** The pin as written, e.g. `^0.10.2`. */
  spec: string;
}

/**
 * The exclusive upper bound a spec admits, or `undefined` when the spec is not
 * one this module can bound. An exact version is its own (inclusive) bound,
 * which the caller treats the same way: below the running version is stale.
 */
function specCeiling(spec: string): string | undefined {
  const match = BOUNDED_SPEC.exec(spec.trim());
  if (match === null) return undefined;
  const [, operator, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);

  if (operator === "~") return `${String(major)}.${String(minor + 1)}.0`;
  if (operator === "^") {
    // Caret holds the left-most non-zero part, which is why `^0.10.2` never
    // reaches 0.11: before 1.0 every minor is a break.
    if (major > 0) return `${String(major + 1)}.0.0`;
    if (minor > 0) return `0.${String(minor + 1)}.0`;
    return `0.0.${String(patch + 1)}`;
  }
  // An exact pin. One past its own patch is the exclusive form of "exactly
  // this", so both shapes share the comparison below. The prerelease is
  // dropped, as `compareVersions` drops it: a nightly and its release carry
  // the same layout.
  return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
}

/** Whether a spec provably cannot resolve to `cliVersion` or anything newer. */
function isStale(spec: string, cliVersion: string): boolean {
  const ceiling = specCeiling(spec);
  return ceiling !== undefined && compareVersions(ceiling, cliVersion) <= 0;
}

/**
 * Every stale pin in `<cwd>/package.json`, in file order: dependency fields
 * first, then scripts. An absent or unreadable `package.json` has no pins.
 *
 * Unreadable is not an error here. This is advice attached to a successful
 * install, and a malformed manifest is something the package manager will
 * report on its own terms; failing the install over it would be the wrong
 * tool refusing.
 */
export async function findStalePins(
  cwd: string,
  cliVersion: string
): Promise<PinnedCli[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];

  const pins: PinnedCli[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = parsed[field];
    if (!isRecord(dependencies)) continue;
    for (const name of PACKAGE_NAMES) {
      const spec = dependencies[name];
      if (typeof spec === "string" && isStale(spec, cliVersion)) {
        pins.push({ location: field, name, spec });
      }
    }
  }

  const scripts = parsed.scripts;
  if (isRecord(scripts)) {
    for (const [script, command] of Object.entries(scripts)) {
      if (typeof command !== "string") continue;
      for (const match of command.matchAll(SCRIPT_PIN)) {
        const [, suffix, spec] = match;
        if (spec !== undefined && isStale(spec, cliVersion)) {
          pins.push({
            location: `scripts.${script}`,
            name: `@taskless/${suffix ?? "cli"}`,
            spec,
          });
        }
      }
    }
  }

  return pins;
}

/**
 * The notice an install prints for stale pins, or `undefined` when there are
 * none.
 *
 * Worded as something to offer, not something done. The install never edits
 * `package.json`: a pin is often deliberate (a CI image, a reproducible
 * build), and bumping it changes a lockfile the person has not seen. What the
 * notice owes them is that the pin and the project now disagree, and which
 * version would agree.
 *
 * A migration changes how sure that disagreement is. Every CLI refuses a
 * scaffold newer than its own highest migration (`SCAFFOLD_VERSION_MISMATCH`),
 * so once this run has written schema `migratedTo`, a pin that predates that
 * schema fails on its first run. That run is CI on the push that carries the
 * migrated files, so the bump has to ride in the same commit, not a later one.
 * Without a migration the layout the pin reads is unchanged and the failure is
 * only probable: the rules may lean on engine behavior the pin does not have.
 */
export function getPinnedCliNotice(
  pins: readonly PinnedCli[],
  cliVersion: string,
  options: { migratedTo?: number } = {}
): string | undefined {
  if (pins.length === 0) return undefined;
  const consequence =
    options.migratedTo === undefined
      ? `Anything that runs these pins (a script, CI, a git hook) runs a CLI older than this project expects and will likely fail. ` +
        `Offer to update them to ${cliVersion} as part of this upgrade, then reinstall dependencies.`
      : `This upgrade migrated .taskless/ to schema version ${String(options.migratedTo)}, and a CLI that predates that schema refuses the project (SCAFFOLD_VERSION_MISMATCH). ` +
        `CI, scripts, and git hooks that run these pins will break on the push that carries the migrated files. ` +
        `Offer to update them to ${cliVersion} and reinstall dependencies, in the same commit as .taskless/.`;
  return [
    `package.json pins a Taskless CLI older than ${cliVersion}, which just upgraded this project:`,
    ...pins.map((pin) => `  - ${pin.location}: ${pin.name} ${pin.spec}`),
    consequence,
  ].join("\n");
}
