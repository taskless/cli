import { glob, readFile } from "node:fs/promises";
import { basename, dirname, join, posix, sep } from "node:path";

import { parse as parseYaml } from "yaml";

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
 * In a monorepo the pin usually lives in a workspace package rather than at
 * the root, and that package's CI job is the one that breaks, so the
 * workspace packages the root declares are read too. See
 * `listWorkspaceManifests()` for what counts as declared.
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
  /**
   * The `package.json` holding the pin, relative to the directory searched
   * and `/`-separated: `package.json` at the root, `packages/app/package.json`
   * in a workspace package.
   */
  manifest: string;
  /** Where the pin lives in it: `devDependencies`, or `scripts.<name>`. */
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
 * How many workspace manifests are read, at most.
 *
 * A pattern like `**` in a large tree can match far more than a workspace
 * means to declare. This is advice on a successful install, so it stops
 * reading rather than make `init` or `info` slow; a tree past the cap is one
 * this check has nothing useful to say about anyway.
 */
const MAX_WORKSPACE_MANIFESTS = 500;

/** Directories a workspace glob never descends into. */
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);

/** The parsed JSON at `path`, or `undefined` when it is absent or malformed. */
async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/** Only the strings of a list that should have held nothing else. */
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * The workspace patterns `cwd` declares: the `workspaces` field of its
 * `package.json` (npm and yarn, as an array or as `{ packages }`), and the
 * `packages` list of `pnpm-workspace.yaml`. Both are read, since a project
 * migrating between managers can carry either, and a pattern in one that the
 * other lacks still names a package something runs.
 */
async function readWorkspacePatterns(
  cwd: string,
  root: unknown
): Promise<string[]> {
  const patterns: string[] = [];
  if (isRecord(root)) {
    const { workspaces } = root;
    patterns.push(
      ...strings(isRecord(workspaces) ? workspaces.packages : workspaces)
    );
  }
  try {
    const parsed: unknown = parseYaml(
      await readFile(join(cwd, "pnpm-workspace.yaml"), "utf8")
    );
    if (isRecord(parsed)) patterns.push(...strings(parsed.packages));
  } catch {
    // Absent or malformed; pnpm reports the latter on its own terms.
  }
  return patterns;
}

/**
 * Every workspace package's `package.json` under `cwd`, as sorted
 * `/`-separated paths relative to it, not including the root's own.
 *
 * Each pattern is expanded by `fs.glob` against `<pattern>/package.json`, so
 * a pattern matches a package exactly when it matches the package's
 * directory, as it does for pnpm, npm and yarn. A `!`-prefixed pattern
 * removes what it matches. A pattern that is absolute or climbs out with
 * `..` is skipped: what it names is not inside this project, and reading it
 * would walk a tree nobody asked about. `node_modules` is never descended
 * into, which is also what keeps `**` affordable.
 */
async function listWorkspaceManifests(
  cwd: string,
  root: unknown
): Promise<string[]> {
  const included = new Set<string>();
  const excluded = new Set<string>();
  let read = 0;
  for (const raw of await readWorkspacePatterns(cwd, root)) {
    const negated = raw.startsWith("!");
    const pattern = posix
      .normalize((negated ? raw.slice(1) : raw).trim())
      .replace(/\/+$/, "");
    if (
      pattern === "" ||
      posix.isAbsolute(pattern) ||
      pattern.split("/").includes("..")
    ) {
      continue;
    }
    for await (const entry of glob(`${pattern}/package.json`, {
      cwd,
      exclude: (path) => SKIPPED_DIRECTORIES.has(basename(path)),
    })) {
      (negated ? excluded : included).add(entry.split(sep).join("/"));
      read += 1;
      if (read >= MAX_WORKSPACE_MANIFESTS) break;
    }
    if (read >= MAX_WORKSPACE_MANIFESTS) break;
  }
  // A `.` pattern names the root, which is read on its own.
  included.delete("package.json");
  return [...included].filter((path) => !excluded.has(path)).toSorted();
}

/**
 * The version of `name` that `directory` runs, or `undefined`.
 *
 * Resolved as Node resolves it: `<directory>/node_modules/<name>`, then each
 * parent's, stopping at `cwd`. With pnpm a workspace package has its own link,
 * and that is what it runs even when the root links another version; with npm
 * or yarn hoisting it may exist only at the root. pnpm links the directory
 * into its store, and reading through the link is what resolves the version
 * actually run.
 */
async function readInstalledVersion(
  cwd: string,
  directory: string,
  name: string
): Promise<string | undefined> {
  for (let current = directory; ; current = dirname(current)) {
    const parsed = await readJson(
      join(current, "node_modules", name, "package.json")
    );
    if (isRecord(parsed) && typeof parsed.version === "string") {
      return parsed.version;
    }
    if (current === cwd || dirname(current) === current) return undefined;
  }
}

/** Every stale pin in one parsed manifest: dependency fields, then scripts. */
async function findPinsIn(
  cwd: string,
  manifest: string,
  parsed: unknown,
  cliVersion: string
): Promise<PinnedCli[]> {
  if (!isRecord(parsed)) return [];
  const directory = join(cwd, dirname(manifest));

  const pins: PinnedCli[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = parsed[field];
    if (!isRecord(dependencies)) continue;
    for (const name of PACKAGE_NAMES) {
      const spec = dependencies[name];
      if (typeof spec !== "string") continue;
      const installed = await readInstalledVersion(cwd, directory, name);
      // Either one is a real failure: an installed build older than this one
      // is what runs today, and a range that cannot reach this version is
      // what a fresh install will resolve.
      const stale =
        (installed !== undefined && compareSemver(installed, cliVersion) < 0) ||
        isStale(spec, cliVersion);
      if (stale) {
        pins.push({
          manifest,
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
            manifest,
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
 * Every stale pin in `<cwd>/package.json` and in each workspace package it
 * declares, root first and then workspace packages by path, each in file
 * order. An absent or unreadable `package.json` has no pins.
 *
 * Unreadable is not an error here. This is advice attached to a successful
 * command, and a malformed manifest is something the package manager will
 * report on its own terms; failing an install over it would be the wrong
 * tool refusing.
 */
export async function findStalePins(
  cwd: string,
  cliVersion: string
): Promise<PinnedCli[]> {
  const root = await readJson(join(cwd, "package.json"));
  const pins = await findPinsIn(cwd, "package.json", root, cliVersion);
  for (const manifest of await listWorkspaceManifests(cwd, root)) {
    pins.push(
      ...(await findPinsIn(
        cwd,
        manifest,
        await readJson(join(cwd, manifest)),
        cliVersion
      ))
    );
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

/**
 * One notice line: which manifest and field the pin is in, what it says, and
 * what to change it to. The manifest is named even at the root, so a list
 * mixing the root with workspace packages reads the same way throughout.
 */
export function describePin(pin: PinnedCli, cliVersion: string): string {
  const target = bumpTarget(cliVersion);
  const installed =
    pin.installed === null ? "" : ` (installed ${pin.installed})`;
  const move =
    pin.name === target.name
      ? `${target.name}@${target.version}`
      : `${target.name}@${target.version}, replacing ${pin.name}`;
  return `  - ${pin.manifest} ${pin.location}: ${pin.name} ${pin.spec}${installed} -> ${move}`;
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
