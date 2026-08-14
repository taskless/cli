import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CLIError } from "../util/cli-error";
import type { Migrations } from "./types";
import init from "./migrations/0001-init";
import installMigration from "./migrations/0002-install";
import dropInstalledAt from "./migrations/0003-drop-installed-at";
import valeEngine from "./migrations/0004-vale-engine";
import ruleDirectories from "./migrations/0005-rule-directories";

export interface TasklessInstallTarget {
  skills?: string[];
  commands?: string[];
  /**
   * Install mode for this target: `canonical` (full content) or `reference`
   * (stubs delegating to the canonical store). Absent in manifests written
   * before this field existed; consumers treat a missing value as canonical.
   */
  mode?: "canonical" | "reference";
}

export interface TasklessInstallManifest {
  cliVersion?: string;
  targets?: Record<string, TasklessInstallTarget>;
  onboarded?: boolean;
}

export interface TasklessManifest {
  version: number;
  install?: TasklessInstallManifest;
}

const MANIFEST_FILE = "taskless.json";

const migrations: Migrations = {
  "1": init,
  "2": installMigration,
  "3": dropInstalledAt,
  "4": valeEngine,
  "5": ruleDirectories,
};

/** Global flag that downgrades a too-new scaffold from an error to a skip. */
export const ALLOW_VERSION_MISMATCHES_FLAG = "--allow-version-mismatches";

/**
 * Whether the invocation opted out of scaffold-version enforcement. Read from
 * raw argv rather than a parsed command, because every command reaches the
 * migration runner through {@link ensureTasklessDirectory} and none of them
 * thread their own options down to it.
 */
export function hasVersionMismatchOverride(
  rawArguments: string[] = process.argv.slice(2)
): boolean {
  return rawArguments.includes(ALLOW_VERSION_MISMATCHES_FLAG);
}

/** Sort migration keys numerically and return [version, migration] pairs */
function sortedMigrations(
  record: Migrations
): Array<[number, Migrations[string]]> {
  return Object.entries(record)
    .map(([key, value]) => [Number(key), value] as [number, Migrations[string]])
    .toSorted(([a], [b]) => a - b);
}

/**
 * Read the manifest file, returning the full parsed record plus the normalized
 * version. Unknown top-level fields are preserved so callers can round-trip
 * them on write.
 */
async function readRawManifest(
  directory: string
): Promise<{ version: number; raw: Record<string, unknown> }> {
  try {
    const content = await readFile(join(directory, MANIFEST_FILE), "utf8");
    const parsed: unknown = JSON.parse(content);
    // Treat any non-object (e.g. `null`, arrays, primitives) as a corrupt
    // manifest so migrations re-run from version 0. Reading `.version`
    // off `null` would otherwise throw TypeError and bypass the fallback.
    if (!isPlainObject(parsed)) {
      return { version: 0, raw: {} };
    }
    const version = Number(parsed.version);
    return {
      version: Number.isFinite(version) ? version : 0,
      raw: parsed,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { version: 0, raw: {} };
    }
    // Treat corrupt/unparseable manifest as version 0 so migrations re-run
    if (error instanceof SyntaxError) {
      return { version: 0, raw: {} };
    }
    throw error;
  }
}

async function writeRawManifest(
  directory: string,
  raw: Record<string, unknown>
): Promise<void> {
  await writeFile(
    join(directory, MANIFEST_FILE),
    JSON.stringify(raw, null, 2) + "\n",
    "utf8"
  );
}

/**
 * Read the full manifest, returning the typed shape. Unknown fields are
 * discarded by this API — if you need round-trip preservation, use
 * {@link readManifest} below and pass its `raw` object back through
 * {@link writeManifest}.
 */
export async function readManifest(
  directory: string
): Promise<{ manifest: TasklessManifest; raw: Record<string, unknown> }> {
  const { version, raw } = await readRawManifest(directory);
  const install = raw.install as TasklessInstallManifest | undefined;
  return {
    manifest: {
      version,
      install: isPlainObject(install) ? install : undefined,
    },
    raw,
  };
}

/**
 * Write the manifest, merging the provided fields over any existing unknown
 * top-level fields stored in `raw`. Callers typically pass the `raw` object
 * returned by {@link readManifest} to preserve forward-compatible state.
 */
export async function writeManifest(
  directory: string,
  manifest: TasklessManifest,
  raw: Record<string, unknown> = {}
): Promise<void> {
  const merged: Record<string, unknown> = { ...raw, version: manifest.version };
  if (manifest.install === undefined) {
    delete merged.install;
  } else {
    merged.install = manifest.install;
  }
  await writeRawManifest(directory, merged);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface RunMigrationsOptions {
  /**
   * Called once before the first pending migration runs. Defaults to a
   * bare `console.error` notice. Callers that own their own UI can pass a
   * custom handler to route the notice through their logger.
   */
  onNotice?: (message: string) => void;
  /**
   * Proceed without applying migrations when the on-disk scaffold is newer
   * than this CLI understands, instead of throwing. Defaults to whether
   * {@link ALLOW_VERSION_MISMATCHES_FLAG} is present in argv.
   */
  allowVersionMismatches?: boolean;
}

/**
 * Run any pending migrations against the .taskless/ directory.
 * Reads the current version from taskless.json and runs migrations
 * whose numeric key is greater than the current version.
 *
 * Throws when the manifest's version is *newer* than the highest migration
 * this CLI knows: an older CLI cannot safely read a layout written by a newer
 * one, so it fails loudly rather than half-reading it.
 */
export async function runMigrations(
  tasklessDirectory: string,
  options: RunMigrationsOptions = {}
): Promise<void> {
  const sorted = sortedMigrations(migrations);
  if (sorted.length === 0) return;

  const maxVersion = sorted.at(-1)![0];
  const { version } = await readRawManifest(tasklessDirectory);

  if (version > maxVersion) {
    if (options.allowVersionMismatches ?? hasVersionMismatchOverride()) {
      return;
    }
    throw new CLIError(
      `This project's .taskless/ scaffold is version ${String(version)}, but this CLI only understands version ${String(maxVersion)}. ` +
        `Upgrade the CLI to continue, or re-run with ${ALLOW_VERSION_MISMATCHES_FLAG} to proceed without migrating.`,
      "SCAFFOLD_VERSION_MISMATCH"
    );
  }

  if (version === maxVersion) {
    return;
  }

  const pending = sorted.filter(([v]) => v > version);
  const notice = options.onNotice ?? ((message) => console.error(message));
  notice("Migrating to latest .taskless/ schema...");
  for (const [v, migrate] of pending) {
    try {
      await migrate(tasklessDirectory);
    } catch (error) {
      console.error(
        `Migration ${String(v)} failed: ${error instanceof Error ? error.message : String(error)}`
      );
      // Write manifest at last successful version so we don't re-run
      // completed migrations. Re-read from disk so we preserve whatever
      // earlier successful migrations wrote (instead of writing back `raw`,
      // which is the pre-run snapshot and could clobber their output).
      if (v > version + 1) {
        const { raw: latestRaw } = await readRawManifest(tasklessDirectory);
        await writeRawManifest(tasklessDirectory, {
          ...latestRaw,
          version: v - 1,
        });
      }
      throw error;
    }
  }

  // Re-read the raw manifest so we preserve anything migrations wrote
  const { raw: latestRaw } = await readRawManifest(tasklessDirectory);
  await writeRawManifest(tasklessDirectory, {
    ...latestRaw,
    version: maxVersion,
  });
}
