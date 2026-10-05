import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { isRecord } from "../util/is-record";
import { compareSemver, compareVersions } from "../util/version-compare";

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
 * A dependency is judged twice, because the range and what runs can
 * disagree. `pnpm add -D @taskless/cli` writes `^0.11.0` and locks 0.11.0;
 * the range admits 0.11.2, but CI installs from the lockfile and runs 0.11.0.
 * So the version installed under `node_modules/` is read first, and is stale
 * when it is older than the running CLI. The range is the fallback for a
 * checkout with nothing installed, and is stale only when it cannot reach the
 * running version at all.
 *
 * Otherwise detection is deliberately narrow. A spec this module cannot bound
 * (`latest`, `*`, `>=`, a `workspace:` or URL spec) is not reported, because
 * "this might be old" is a guess, and a notice that guesses is one an agent
 * learns to skip.
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
 * The lookbehind keeps a longer name (`foo@taskless/cli@…`) from matching,
 * and the version stops at shell punctuation, so `@0.10.2,` or `@0.10.2>log`
 * still reads as `0.10.2`.
 */
const SCRIPT_PIN =
  /(?<![\w@/.-])@taskless\/(cli-nightly|cli)@([^\s"'`;&|()<>,:]+)/g;

/**
 * `1.2.3`, optionally prefixed `^` or `~`, or `=`, and `v`, with optional
 * prerelease and build metadata. Space after the operator is allowed, as npm
 * allows it.
 */
const BOUNDED_SPEC =
  /^([\^~=])?\s*v?(\d+)\.(\d+)\.(\d+)(-[\w.-]+)?(\+[\w.-]+)?$/;

/** One pin that would run a CLI older than the one that just ran. */
export interface PinnedCli {
  /** Where the pin lives: `devDependencies`, or `scripts.<name>`. */
  location: string;
  /** The package the pin names. */
  name: string;
  /** The pin as written, e.g. `^0.10.2`. */
  spec: string;
  /**
   * The version installed under `node_modules/`, for a dependency pin whose
   * package is installed; `null` otherwise. When present it is what was
   * judged, since it is what runs.
   */
  installed: string | null;
}

/**
 * Whether a spec provably cannot resolve to `cliVersion` or anything newer.
 *
 * An exact pin is compared with prerelease precedence, so an older nightly of
 * the same base is stale. A range is compared by its exclusive ceiling on the
 * numeric core: `^0.10.2` admits nothing from 0.11.0 up, and npm does not
 * resolve a range to a prerelease of another base anyway.
 */
function isStale(spec: string, cliVersion: string): boolean {
  const match = BOUNDED_SPEC.exec(spec.trim());
  if (match === null) return false;
  const [, operator, majorText, minorText, patchText, prerelease] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);

  if (operator === "~") {
    return (
      compareVersions(`${String(major)}.${String(minor + 1)}.0`, cliVersion) <=
      0
    );
  }
  if (operator === "^") {
    // Caret holds the left-most non-zero part, which is why `^0.10.2` never
    // reaches 0.11: before 1.0 every minor is a break.
    const ceiling =
      major > 0
        ? `${String(major + 1)}.0.0`
        : minor > 0
          ? `0.${String(minor + 1)}.0`
          : `0.0.${String(patch + 1)}`;
    return compareVersions(ceiling, cliVersion) <= 0;
  }
  const exact = `${String(major)}.${String(minor)}.${String(patch)}${prerelease ?? ""}`;
  return compareSemver(exact, cliVersion) < 0;
}

/**
 * The version of `name` installed under `<cwd>/node_modules/`, or `undefined`.
 * pnpm links the directory into its store; reading through the link is what
 * resolves the version the project actually runs.
 */
async function readInstalledVersion(
  cwd: string,
  name: string
): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(cwd, "node_modules", name, "package.json"), "utf8")
    );
    return isRecord(parsed) && typeof parsed.version === "string"
      ? parsed.version
      : undefined;
  } catch {
    return undefined;
  }
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
      if (typeof spec !== "string") continue;
      const installed = await readInstalledVersion(cwd, name);
      // Either one is a real failure: an installed build older than this one
      // is what runs today, and a range that cannot reach this version is
      // what a fresh install will resolve.
      const stale =
        (installed !== undefined && compareSemver(installed, cliVersion) < 0) ||
        isStale(spec, cliVersion);
      if (stale) {
        pins.push({
          location: field,
          name,
          spec,
          installed: installed ?? null,
        });
      }
    }
  }

  const scripts = parsed.scripts;
  if (isRecord(scripts)) {
    for (const [script, command] of Object.entries(scripts)) {
      if (typeof command !== "string") continue;
      const seen = new Set<string>();
      for (const match of command.matchAll(SCRIPT_PIN)) {
        const [, suffix, spec] = match;
        const name = `@taskless/${suffix ?? "cli"}`;
        // `a && npx @taskless/cli@0.10.2 x && npx @taskless/cli@0.10.2 y`
        // is one pin to change, not two.
        if (spec === undefined || seen.has(`${name}@${spec}`)) continue;
        seen.add(`${name}@${spec}`);
        if (isStale(spec, cliVersion)) {
          pins.push({
            location: `scripts.${script}`,
            name,
            spec,
            installed: null,
          });
        }
      }
    }
  }

  return pins;
}

/**
 * The package and version to move a pin to: the package that actually carries
 * `cliVersion`. A nightly is always `<base>-<stamp>x<sha>` and a release never
 * has a prerelease, so the version alone says which one it is, and a pin on
 * the other package has to switch names rather than name a version its own
 * package never published.
 */
function bumpTarget(cliVersion: string): { name: string; version: string } {
  const [release, nightly] = PACKAGE_NAMES;
  return {
    name: cliVersion.includes("-") ? nightly : release,
    version: cliVersion,
  };
}

/** One notice line: where the pin is, what it says, and what to change it to. */
function describePin(pin: PinnedCli, cliVersion: string): string {
  const target = bumpTarget(cliVersion);
  const installed =
    pin.installed === null ? "" : ` (installed ${pin.installed})`;
  const move =
    pin.name === target.name
      ? `${target.name}@${target.version}`
      : `${target.name}@${target.version}, replacing ${pin.name}`;
  return `  - ${pin.location}: ${pin.name} ${pin.spec}${installed} -> ${move}`;
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
 * A migration of an EXISTING scaffold changes how sure that disagreement is.
 * Every CLI refuses a scaffold newer than its own highest migration
 * (`SCAFFOLD_VERSION_MISMATCH`), so once this run has moved the project to
 * schema `to`, a pin that predates that schema fails on its first run. That
 * run is CI on the push that carries the migrated files, so the bump has to
 * ride in the same commit, not a later one.
 *
 * A migration from schema 0 is not that. It is how a fresh `init` creates
 * `.taskless/`, so there was no upgrade and no layout the pin used to read;
 * calling it one would be false on the face of it. That case, like a run with
 * no migration, says the failure is likely rather than certain.
 */
export function getPinnedCliNotice(
  pins: readonly PinnedCli[],
  cliVersion: string,
  options: { migrated?: { from: number; to: number } } = {}
): string | undefined {
  if (pins.length === 0) return undefined;
  const upgraded =
    options.migrated !== undefined && options.migrated.from > 0
      ? options.migrated
      : undefined;
  const consequence =
    upgraded === undefined
      ? `Anything that runs these pins (a script, CI, a git hook) runs a CLI older than this project expects and will likely fail. ` +
        `Offer to update them as shown as part of this change, then reinstall dependencies.`
      : `This upgrade migrated .taskless/ from schema version ${String(upgraded.from)} to ${String(upgraded.to)}, and a CLI that predates that schema refuses the project (SCAFFOLD_VERSION_MISMATCH). ` +
        `CI, scripts, and git hooks that run these pins will break on the push that carries the migrated files. ` +
        `Offer to update them as shown and reinstall dependencies, in the same commit as .taskless/.`;
  return [
    `package.json pins a Taskless CLI older than ${cliVersion}, the version that just ran here:`,
    ...pins.map((pin) => describePin(pin, cliVersion)),
    consequence,
  ].join("\n");
}
