import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import template from "../../assets/launcher/launcher.mjs?raw";
import { buildInvocation } from "../util/invocation";

/**
 * The project launcher: a small Node script under `.taskless/bin/` that runs
 * the Taskless CLI version the project recorded for one package.
 *
 * Each package has its own file and is the only build that writes it, so a
 * nightly installed beside the release never changes what the release's
 * launcher runs. The reverse holds only until the release is installed again:
 * that is the move back to mainline, and it retires the nightly's launcher
 * (see {@link retiredLauncherPackage}). The version is read from
 * `.taskless/taskless.json` when the launcher runs rather than written into
 * it, so the file's bytes are the same for every version of its package and an
 * upgrade only moves a line of JSON.
 *
 * The template's comments describe what it does and nothing more. An agent
 * that reads the file is judging whether to run it, and a comment framing the
 * launcher as a way past a permission check is what gets it refused.
 */

/**
 * The package names a launcher can run. Package names, not invocations: each
 * launcher names its own package in every build, which is what keeps the
 * release's and a nightly's apart.
 */
export const LAUNCHER_PACKAGES = [
  // ast-grep-ignore: no-unrouted-cli-invocation
  "@taskless/cli",
  // ast-grep-ignore: no-unrouted-cli-invocation
  "@taskless/cli-nightly",
] as const;

export type LauncherPackage = (typeof LAUNCHER_PACKAGES)[number];

/** The token the template spells its package with. */
const PACKAGE_PLACEHOLDER = "%(TASKLESS_PACKAGE)s";

/** The launcher's file name for a package. */
export function launcherFileName(packageName: LauncherPackage): string {
  return packageName.endsWith("-nightly") ? "cli-nightly.mjs" : "cli.mjs";
}

/** The launcher's path relative to the project root, `/`-separated. */
export function launcherPath(packageName: LauncherPackage): string {
  return `.taskless/bin/${launcherFileName(packageName)}`;
}

/**
 * How an agent or a person runs a package's launcher from the project root:
 * `./.taskless/bin/cli.mjs`. This exact spelling is what permission rules and
 * the global trust entry allow.
 */
export function launcherInvocation(packageName: LauncherPackage): string {
  return `./${launcherPath(packageName)}`;
}

/**
 * The lockfile a package's launcher installs from, relative to the project
 * root: `.taskless/bin/cli.lock.json` beside `cli.mjs`. One per package, like
 * the launcher, and written only by that package's builds.
 */
export function lockfilePath(packageName: LauncherPackage): string {
  return launcherPath(packageName).replace(/\.mjs$/, ".lock.json");
}

/** Where launchers keep installed versions, relative to the project root. */
export const LAUNCHER_CACHE = ".taskless/.cache";

/**
 * A package version's directory in the cache, relative to the project root:
 * `.taskless/.cache/@taskless/cli@0.13.1`.
 */
export function cacheEntryPath(
  packageName: LauncherPackage,
  version: string
): string {
  return `${LAUNCHER_CACHE}/${packageName}@${version}`;
}

/** The launcher's full content for a package. */
export function renderLauncher(packageName: LauncherPackage): string {
  return template.replaceAll(PACKAGE_PLACEHOLDER, packageName);
}

/**
 * The package this build's launcher runs, or `undefined` for a build that has
 * none. A `self` build runs from a path in this checkout, not from a published
 * package, so there is no version for a launcher to pin.
 */
export function buildLauncherPackage(): LauncherPackage | undefined {
  switch (__TASKLESS_BUILD_TARGET__) {
    case "prod": {
      return LAUNCHER_PACKAGES[0];
    }
    case "nightly": {
      return LAUNCHER_PACKAGES[1];
    }
    default: {
      return undefined;
    }
  }
}

/**
 * What an install did to this build's launcher. `restored` means a launcher
 * was there with other bytes: it runs whatever it contains under any rule that
 * allows its path, so an edit is put back and said out loud.
 */
export interface LauncherWrite {
  path: string;
  state: "unchanged" | "created" | "restored";
}

/**
 * Write a package's launcher into `cwd`, only when its bytes differ, and make
 * it executable either way: a checkout can drop the mode bit while keeping the
 * content.
 */
export async function writeLauncher(
  cwd: string,
  packageName: LauncherPackage
): Promise<LauncherWrite> {
  const write = await writeInstallFile(
    cwd,
    launcherPath(packageName),
    renderLauncher(packageName)
  );
  await chmod(join(cwd, write.path), 0o755);
  return write;
}

/** Write `content` to `path` under `cwd` only when the bytes differ. */
async function writeInstallFile(
  cwd: string,
  path: string,
  content: string
): Promise<LauncherWrite> {
  const absolute = join(cwd, path);
  let existing: string | undefined;
  try {
    existing = await readFile(absolute, "utf8");
  } catch {
    // Absent or unreadable: written below.
  }
  if (existing !== content) {
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  return {
    path,
    state:
      existing === undefined
        ? "created"
        : existing === content
          ? "unchanged"
          : "restored",
  };
}

/**
 * Write this build's lockfile beside its package's launcher, only when its
 * bytes differ. An edited lockfile is put back and reported like an edited
 * launcher: it decides what the launcher installs.
 */
export function writeLauncherLockfile(
  cwd: string,
  packageName: LauncherPackage,
  content: string
): Promise<LauncherWrite> {
  return writeInstallFile(cwd, lockfilePath(packageName), content);
}

/**
 * The package a build retires when it installs, or `undefined`. A release
 * install is the move back to mainline, so it removes the nightly. A nightly
 * installs alongside the release and retires nothing.
 */
export function retiredLauncherPackage(
  packageName: LauncherPackage | undefined
): LauncherPackage | undefined {
  const [release, nightly] = LAUNCHER_PACKAGES;
  return packageName === release ? nightly : undefined;
}

/**
 * Remove a package's launcher and its lockfile from `cwd`, returning the paths
 * that were there. Its cache entry goes with the next prune, once nothing
 * records its version.
 */
export async function retireLauncher(
  cwd: string,
  packageName: LauncherPackage
): Promise<string[]> {
  const removed: string[] = [];
  for (const path of [launcherPath(packageName), lockfilePath(packageName)]) {
    const present = await stat(join(cwd, path)).then(
      () => true,
      () => false
    );
    if (!present) continue;
    await rm(join(cwd, path), { force: true });
    removed.push(path);
  }
  return removed;
}

/** Remove a path, leaving it for the next prune when that fails. */
async function removeQuietly(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => {});
}

/** How old a temporary install directory must be before a prune removes it. */
const STALE_INSTALL_MS = 60 * 60 * 1000;

/**
 * The version a package's launcher would run: its `install.launchers` entry,
 * or `install.cliVersion` when that belongs to the package (a nightly version
 * always has a prerelease part, a release's never does). The template applies
 * the same rule when it runs.
 */
export function recordedLauncherVersion(
  packageName: LauncherPackage,
  launchers: Record<string, string> | undefined,
  cliVersion: string | undefined
): string | undefined {
  const recorded = launchers?.[packageName];
  if (recorded !== undefined) return recorded;
  if (
    cliVersion !== undefined &&
    cliVersion.includes("-") === packageName.endsWith("-nightly")
  ) {
    return cliVersion;
  }
  return undefined;
}

/**
 * Remove cache entries no package records, and temporary install directories
 * old enough that no install can still be writing them. Best effort: anything
 * that cannot be removed now, such as a file Windows holds open, is left for
 * the next prune. The launcher template carries its own copy of this rule,
 * since it runs without the CLI.
 */
export async function pruneLauncherCache(
  cwd: string,
  launchers: Record<string, string> | undefined,
  cliVersion: string | undefined,
  now: number = Date.now()
): Promise<void> {
  const keep = new Set<string>();
  for (const packageName of LAUNCHER_PACKAGES) {
    const version = recordedLauncherVersion(packageName, launchers, cliVersion);
    if (version !== undefined) keep.add(cacheEntryPath(packageName, version));
  }
  const cache = join(cwd, LAUNCHER_CACHE);

  let top: string[];
  try {
    top = await readdir(cache);
  } catch {
    return;
  }
  for (const name of top) {
    if (!name.startsWith(".tmp-")) continue;
    const path = join(cache, name);
    const modified = await stat(path).then(
      (info) => info.mtimeMs,
      () => now
    );
    if (now - modified > STALE_INSTALL_MS) await removeQuietly(path);
  }

  const scopes = new Set(
    LAUNCHER_PACKAGES.map((packageName) => packageName.split("/")[0] ?? "")
  );
  for (const scope of scopes) {
    let entries: string[];
    try {
      entries = await readdir(join(cache, scope));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relative = `${LAUNCHER_CACHE}/${scope}/${entry}`;
      const ours = LAUNCHER_PACKAGES.some((packageName) =>
        relative.startsWith(`${LAUNCHER_CACHE}/${packageName}@`)
      );
      if (ours && !keep.has(relative))
        await removeQuietly(join(cache, scope, entry));
    }
  }
}

/**
 * What the installed skill names the CLI as: this build's launcher, so the
 * rendered skill is the same for every version of a package and agents run the
 * spelling harnesses allow by path. A build with no launcher names its own
 * invocation, as before.
 */
export function skillInvocation(): string {
  return buildLauncherInvocation() ?? buildInvocation();
}

/** This build's launcher invocation, or `undefined` when it installs none. */
export function buildLauncherInvocation(): string | undefined {
  const packageName = buildLauncherPackage();
  return packageName === undefined
    ? undefined
    : launcherInvocation(packageName);
}

/** The line an install prints for a launcher file it retired. */
export function describeRetired(path: string): string {
  return `Removed ${path} (this release replaces the nightly)`;
}

/**
 * The line an install prints for a launcher it wrote. A restored launcher is
 * named as such: it had been edited, and it runs under any rule that allows
 * its path.
 */
export function describeLauncherWrite(write: LauncherWrite): string {
  return write.state === "restored"
    ? `Restored ${write.path} (it had been edited)`
    : `Created ${write.path}`;
}
