import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Migration } from "../types";
import { isRecord } from "../../util/is-record";
import { LAUNCHER_PACKAGES } from "../../install/launcher";

const MANIFEST_FILE = "taskless.json";

/** A version a launcher can run. Anything else is left where it is. */
const VERSION = /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i;

/**
 * The package a version recorded only as `install.cliVersion` belongs to, or
 * `undefined` for a version no package publishes.
 *
 * This is the one place a channel is still read off a version string, and it
 * only ever reads values written before `install.launchers` existed. A release
 * has no prerelease part. A local self build ends in `-self` and belongs to no
 * package. Any other prerelease is a nightly, which covers both a published
 * nightly (`<base>-<stamp>x<sha>`) and a `build:next` one
 * (`<next>-next-<sha>`).
 */
export function legacyLauncherPackage(
  version: string
): (typeof LAUNCHER_PACKAGES)[number] | undefined {
  const [release, nightly] = LAUNCHER_PACKAGES;
  if (version.endsWith("-self")) return undefined;
  return /^\d+\.\d+\.\d+$/.test(version) ? release : nightly;
}

/**
 * Migration 13 — record a legacy `install.cliVersion` in `install.launchers`.
 *
 * `install.launchers` is the only record of which version each package's
 * launcher runs; `cliVersion` is the last version that installed, for display.
 * A manifest written before `launchers` existed names its version only in
 * `cliVersion`, so this moves it, once, under the package that published it.
 * The CLI then reads `launchers` alone.
 *
 * `cliVersion` itself is kept: it is still the display value. A `-self`
 * version, or one that is not a version at all, belongs to no package and
 * records nothing.
 *
 * Idempotent: a manifest whose `launchers` already records any version is the
 * new shape and is left untouched, so a crash after the write replays as a
 * no-op. Every other field, in `install` and outside it, is preserved.
 */
const migration: Migration = async (directory) => {
  const manifestPath = join(directory, MANIFEST_FILE);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch {
    // Missing or unparseable: nothing to move.
    return;
  }
  if (!isRecord(raw) || !isRecord(raw.install)) return;
  const install = raw.install;

  const launchers = isRecord(install.launchers) ? install.launchers : undefined;
  if (
    launchers !== undefined &&
    Object.values(launchers).some((version) => typeof version === "string")
  ) {
    return;
  }

  const { cliVersion } = install;
  if (typeof cliVersion !== "string" || !VERSION.test(cliVersion)) return;
  const packageName = legacyLauncherPackage(cliVersion);
  if (packageName === undefined) return;

  install.launchers = { ...launchers, [packageName]: cliVersion };
  await writeFile(manifestPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
};

export default migration;
