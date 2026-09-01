import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CLIError } from "../util/cli-error";
import type { Migrations } from "./types";
import { diffSnapshots, snapshotPaths, type TreeChanges } from "./snapshot";
import init from "./migrations/0001-init";
import installMigration from "./migrations/0002-install";
import dropInstalledAt from "./migrations/0003-drop-installed-at";
import valeEngine from "./migrations/0004-vale-engine";
import ruleDirectories from "./migrations/0005-rule-directories";
import refreshReadme from "./migrations/0006-refresh-readme";

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

/**
 * What the project's rules were last reconciled against.
 *
 * Separate from `install` on purpose, because the two answer different
 * questions and drift apart. `install` records how the scaffold got here;
 * `rules` records what the rules are valid against. Conflating them is what
 * made `install.cliVersion` a bad candidate for this: a skills refresh moves
 * it without anyone having read a rule.
 *
 * Every field here advances ONLY on a completed reconciliation, never on an
 * upgrade. If a CLI bump silently rewrote `engines.sg` to the newly vendored
 * version, the field would always report "current" and the divergence it
 * exists to expose would be invisible.
 */
export interface TasklessRulesManifest {
  /** CLI version whose ledger entries have all been walked and acted on. */
  reconciledTo?: string;
  /**
   * Engine versions the rules were authored and last reconciled against.
   *
   * Engine version is what determines whether matching semantics moved under
   * a rule, so recording it is what lets a later differential ask a concrete
   * question instead of reconstructing one.
   */
  engines?: {
    sg?: string;
    vale?: string;
  };
}

export interface TasklessManifest {
  version: number;
  install?: TasklessInstallManifest;
  rules?: TasklessRulesManifest;
}

const MANIFEST_FILE = "taskless.json";

const migrations: Migrations = {
  "1": init,
  "2": installMigration,
  "3": dropInstalledAt,
  "4": valeEngine,
  "5": ruleDirectories,
  "6": refreshReadme,
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
  const rules = raw.rules as TasklessRulesManifest | undefined;
  return {
    manifest: {
      version,
      install: isPlainObject(install) ? install : undefined,
      rules: isPlainObject(rules) ? rules : undefined,
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
  if (manifest.rules === undefined) {
    delete merged.rules;
  } else {
    merged.rules = manifest.rules;
  }
  await writeRawManifest(directory, merged);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What one migration run changed, in a form a caller can print or hand to a
 * machine consumer.
 *
 * The migration is a precondition of `check` and `verify` rather than a side
 * effect, so it will keep happening automatically. What this makes possible is
 * for the run that triggered it to *say so*: without a report, a caller reading
 * `{"success":true}` has no way to learn that the working tree was rewritten
 * underneath it, and an unexplained diff is left looking like someone else's.
 */
export interface MigrationReport {
  /** Scaffold version found on disk before anything ran. */
  from: number;
  /** Scaffold version written on completion. */
  to: number;
  /** Every migration applied, in the order they ran. */
  applied: number[];
  /** Files the run added, rewrote, or deleted, relative to the project root. */
  files: TreeChanges;
}

/** Paths a migration can write, relative to the project root. */
const WATCHED_PATHS = [".taskless", ".gitignore"];

/** Cap on how many paths the human notice lists before summarizing. */
const NOTICE_PATH_LIMIT = 20;

/** Render {@link MigrationReport} as the completion notice a person reads. */
export function formatMigrationNotice(report: MigrationReport): string {
  const { added, modified, removed } = report.files;
  const lines = [
    ...added.map((path) => `  + ${path}`),
    ...modified.map((path) => `  ~ ${path}`),
    ...removed.map((path) => `  - ${path}`),
  ];
  const total = lines.length;
  const shown =
    total > NOTICE_PATH_LIMIT
      ? [
          ...lines.slice(0, NOTICE_PATH_LIMIT),
          `  ... and ${String(total - NOTICE_PATH_LIMIT)} more`,
        ]
      : lines;
  const headline =
    `Migrated .taskless/ from schema version ${String(report.from)} to ` +
    `${String(report.to)}: ${String(added.length)} added, ` +
    `${String(modified.length)} modified, ${String(removed.length)} removed.`;
  return total === 0 ? headline : [headline, ...shown].join("\n");
}

export interface RunMigrationsOptions {
  /**
   * Called once before the first pending migration runs and once after the
   * run completes, the second time with the file-by-file summary. Defaults to
   * a bare `console.error` notice. Callers that own their own UI can pass a
   * custom handler to route the notices through their logger.
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
 * The schema version a current CLI migrates a project to.
 *
 * Derived from the migration map rather than declared beside it, so adding a
 * migration cannot leave a constant behind. Exported because tests kept
 * hardcoding the number, which made every schema bump a hunt for literals and
 * turned "reaches the latest version" into "reaches 5" — an assertion that
 * silently stops meaning what it was written to mean.
 */
export const LATEST_SCHEMA_VERSION: number =
  sortedMigrations(migrations).at(-1)?.[0] ?? 0;

/**
 * Run any pending migrations against the .taskless/ directory.
 * Reads the current version from taskless.json and runs migrations
 * whose numeric key is greater than the current version.
 *
 * Throws when the manifest's version is *newer* than the highest migration
 * this CLI knows: an older CLI cannot safely read a layout written by a newer
 * one, so it fails loudly rather than half-reading it.
 *
 * Returns a {@link MigrationReport} when something ran, and `undefined` when
 * nothing did. The distinction is the point: a caller must be able to tell
 * "the tree was rewritten" from "nothing happened" without guessing.
 */
export async function runMigrations(
  tasklessDirectory: string,
  options: RunMigrationsOptions = {}
): Promise<MigrationReport | undefined> {
  const sorted = sortedMigrations(migrations);
  if (sorted.length === 0) return undefined;

  const maxVersion = sorted.at(-1)![0];
  const { version } = await readRawManifest(tasklessDirectory);

  if (version > maxVersion) {
    if (options.allowVersionMismatches ?? hasVersionMismatchOverride()) {
      return undefined;
    }
    throw new CLIError(
      `This project's .taskless/ scaffold is version ${String(version)}, but this CLI only understands version ${String(maxVersion)}. ` +
        `Upgrade the CLI to continue, or re-run with ${ALLOW_VERSION_MISMATCHES_FLAG} to proceed without migrating.`,
      "SCAFFOLD_VERSION_MISMATCH"
    );
  }

  if (version === maxVersion) {
    return undefined;
  }

  const pending = sorted.filter(([v]) => v > version);
  const notice = options.onNotice ?? ((message) => console.error(message));
  notice(
    `Migrating .taskless/ from schema version ${String(version)} to ${String(maxVersion)}...`
  );

  // Observed rather than self-reported: the migrations write through plain
  // `fs` calls in five separate modules, and asking each to keep a list of
  // what it touched would leave the report only as honest as its bookkeeping.
  // Hashing the tree before and after answers the question the caller is
  // actually asking, which is what changed on disk.
  const projectRoot = join(tasklessDirectory, "..");
  const before = await snapshotPaths(projectRoot, WATCHED_PATHS);

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

  const report: MigrationReport = {
    from: version,
    to: maxVersion,
    applied: pending.map(([v]) => v),
    files: diffSnapshots(
      before,
      await snapshotPaths(projectRoot, WATCHED_PATHS)
    ),
  };
  notice(formatMigrationNotice(report));
  return report;
}
