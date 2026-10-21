import { access } from "node:fs/promises";
import { join } from "node:path";

import { readManifest } from "../filesystem/manifest";
import { hasVersionMismatchOverride } from "../filesystem/migrate";
import { CLIError } from "../util/cli-error";
import { isRecord } from "../util/is-record";
import { getCliPrefix } from "../util/package-manager";
import { compareSemver } from "../util/version-compare";
import { CLI_VERSION } from "../version";
import {
  buildLauncherPackage,
  LAUNCHER_PACKAGES,
  launcherPath,
  recordedLauncherVersion,
  type LauncherPackage,
} from "./launcher";

/**
 * Refusing to run as a CLI the project did not record.
 *
 * A project's rules are reconciled against one CLI, and through it one
 * ast-grep and one Vale. The scaffold `version` cannot say which: rule
 * migrations deliberately leave it alone, so that an engine upgrade does not
 * break every pinned CI. Without this, `npx @taskless/cli@latest update --rules`
 * migrates the rules past the `devDependencies` pin CI runs, and nothing
 * refuses either side.
 *
 * So the CLI that runs has to be the CLI the project recorded, however it was
 * started. `init` is the one command that moves that record, which makes it
 * the one way to upgrade.
 */

/**
 * Subcommands that run on any version. `init` moves the record. The others
 * read no rules and serve no recipes, and `info` is where a reader goes to
 * understand this refusal. `update` is NOT here: it moves the rules' record,
 * not the CLI's, so running it on another version is exactly the case this
 * exists to stop.
 */
const EXEMPT_COMMANDS: ReadonlySet<string> = new Set([
  "init",
  "info",
  "auth",
  "feedback",
]);

/** A mismatch between this CLI and the version the project records. */
export interface VersionMismatch {
  /** The package and version this process is. */
  runningPackage: LauncherPackage;
  running: string;
  /** The package and version the project records, which this is not. */
  recordedPackage: LauncherPackage;
  recorded: string;
}

/** Read `install` defensively: a hand-edited manifest can hold anything. */
function recordedVersions(install: unknown): {
  launchers: Record<string, string> | undefined;
  cliVersion: string | undefined;
} {
  if (!isRecord(install))
    return { launchers: undefined, cliVersion: undefined };
  const launchers = isRecord(install.launchers)
    ? Object.fromEntries(
        Object.entries(install.launchers).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    : undefined;
  const cliVersion =
    typeof install.cliVersion === "string" ? install.cliVersion : undefined;
  return { launchers, cliVersion };
}

/**
 * The mismatch, or `undefined` when there is nothing to refuse.
 *
 * "Recorded" is what this package's project launcher would run, so the gate
 * and the launcher cannot disagree. A project carrying both a release and a
 * nightly launcher refuses neither. A project that records only the other
 * package is a mismatch: the choice was any mismatch, and a channel is part of
 * the version.
 */
export function findVersionMismatch(input: {
  command: string | undefined;
  running: string;
  runningPackage: LauncherPackage | undefined;
  install: unknown;
}): VersionMismatch | undefined {
  const { command, running, runningPackage } = input;
  if (command === undefined || EXEMPT_COMMANDS.has(command)) return undefined;
  // A `self` build runs from this checkout and has no published version to
  // match; outside a build the version is unknown.
  if (runningPackage === undefined || running === "unknown") return undefined;

  const { launchers, cliVersion } = recordedVersions(input.install);
  const own = recordedLauncherVersion(runningPackage, launchers, cliVersion);
  if (own !== undefined) {
    return own === running
      ? undefined
      : {
          runningPackage,
          running,
          recordedPackage: runningPackage,
          recorded: own,
        };
  }

  for (const other of LAUNCHER_PACKAGES) {
    if (other === runningPackage) continue;
    const version = recordedLauncherVersion(other, launchers, cliVersion);
    if (version !== undefined) {
      return {
        runningPackage,
        running,
        recordedPackage: other,
        recorded: version,
      };
    }
  }
  return undefined;
}

/**
 * The refusal's text. The remedy depends on direction: a newer CLI can move
 * the project to itself with `init`, an older one should not be told to, since
 * that would be a downgrade.
 */
export function versionMismatchMessage(
  mismatch: VersionMismatch,
  options: { command: string; launcherExists: boolean; prefix: string }
): string {
  const { runningPackage, running, recordedPackage, recorded } = mismatch;
  const launcher = `./${launcherPath(recordedPackage)}`;
  const sameChannel = runningPackage === recordedPackage;
  const newer = !sameChannel || compareSemver(running, recorded) > 0;

  const lines = [
    `This is ${runningPackage} ${running}, and this project runs ${recordedPackage} ${recorded}, as recorded in .taskless/taskless.json. ` +
      `A project's rules are reconciled against the CLI it records, so another version does not run them.`,
    "",
  ];
  const useLauncher = options.launcherExists
    ? `run \`${launcher} ${options.command}\`, which runs ${recorded}`
    : undefined;
  if (newer) {
    const moveTo = `run \`${options.prefix} init\` to move the project to ${running}`;
    lines.push(
      useLauncher === undefined
        ? `To use this CLI, ${moveTo}.`
        : `To use the recorded version, ${useLauncher}. To use this one, ${moveTo}.`
    );
  } else {
    lines.push(
      useLauncher === undefined
        ? `Run ${recordedPackage} ${recorded}: update whatever started this CLI, such as a package.json pin or a script, to that version.`
        : `To use the recorded version, ${useLauncher}, or update whatever started this CLI, such as a package.json pin or a script, to ${recorded}.`
    );
  }
  lines.push(
    "",
    "Pass --allow-version-mismatches to run anyway, knowing the rules may not match this CLI's engines."
  );
  return lines.join("\n");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Throw `CLI_VERSION_MISMATCH` when this process is not the CLI the project
 * records. Called once, before dispatch, so no subcommand can forget it.
 *
 * A manifest that cannot be read is not refused here. The command it reaches
 * reports `SCAFFOLD_MANIFEST_UNREADABLE` itself, with the remedy that fits.
 */
export async function requireRecordedVersion(
  cwd: string,
  command: string | undefined,
  rawArguments: string[]
): Promise<void> {
  if (hasVersionMismatchOverride(rawArguments)) return;
  const tasklessDirectory = join(cwd, ".taskless");
  let install: unknown;
  try {
    const { manifest } = await readManifest(tasklessDirectory);
    install = manifest.install;
  } catch {
    return;
  }

  const mismatch = findVersionMismatch({
    command,
    running: CLI_VERSION,
    runningPackage: buildLauncherPackage(),
    install,
  });
  if (mismatch === undefined) return;

  throw new CLIError(
    versionMismatchMessage(mismatch, {
      command: command ?? "",
      launcherExists: await exists(
        join(cwd, launcherPath(mismatch.recordedPackage))
      ),
      prefix: getCliPrefix(),
    }),
    "CLI_VERSION_MISMATCH"
  );
}
