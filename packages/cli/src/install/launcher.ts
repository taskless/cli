import template from "../../assets/launcher/launcher.mjs?raw";

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

/** The package names a launcher can run. */
// ast-grep-ignore: no-unrouted-cli-invocation
export const LAUNCHER_PACKAGES = [
  "@taskless/cli",
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
