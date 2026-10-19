import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import template from "../../assets/launcher/launcher.mjs?raw";
import { buildInvocation } from "../util/invocation";

/**
 * The project launcher: a small Node script under `.taskless/bin/` that runs
 * the Taskless CLI version the project recorded for one package.
 *
 * Each package has its own file and is the only build that writes it, so a
 * nightly installed beside the release never changes what the release's
 * launcher runs, and the reverse. The version is read from
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
  const path = launcherPath(packageName);
  const absolute = join(cwd, path);
  const content = renderLauncher(packageName);
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
  await chmod(absolute, 0o755);
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
 * What the installed skill names the CLI as: this build's launcher, so the
 * rendered skill is the same for every version of a package and agents run the
 * spelling harnesses allow by path. A build with no launcher names its own
 * invocation, as before.
 */
export function skillInvocation(): string {
  const packageName = buildLauncherPackage();
  return packageName === undefined
    ? buildInvocation()
    : launcherInvocation(packageName);
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
