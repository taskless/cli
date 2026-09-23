import { join } from "node:path";
import process from "node:process";

import { CLIError } from "../util/cli-error";
import { buildInvocation } from "../util/invocation";
import { pathExists } from "../rules/reconcile-marker";
import { readRawManifest, writeRawManifest } from "./manifest";
import type { Migrations } from "./types";
import { diffSnapshots, snapshotPaths, type TreeChanges } from "./snapshot";
import init from "./migrations/0001-init";
import installMigration from "./migrations/0002-install";
import dropInstalledAt from "./migrations/0003-drop-installed-at";
import valeEngine from "./migrations/0004-vale-engine";
import ruleDirectories from "./migrations/0005-rule-directories";
import refreshReadme from "./migrations/0006-refresh-readme";
import ignoreScratchFiles from "./migrations/0007-ignore-scratch-files";
import dropBasedOnStyles from "./migrations/0008-drop-based-on-styles";
import uniqueRuleIds from "./migrations/0009-unique-rule-ids";

const migrations: Migrations = {
  "1": init,
  "2": installMigration,
  "3": dropInstalledAt,
  "4": valeEngine,
  "5": ruleDirectories,
  "6": refreshReadme,
  "7": ignoreScratchFiles,
  "8": dropBasedOnStyles,
  "9": uniqueRuleIds,
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

// ---------------------------------------------------------------------------
// A MIGRATION OWNS EVERYTHING UNDER `.taskless/`, INCLUDING THE PROSE.
//
// If a migration moves, renames or deletes anything in that directory, the
// files describing the directory are wrong from that moment, and the migration
// is the only commit that knows it. Every other mechanism — a reviewer, a
// linter, someone noticing — runs later than the moment the fact changed.
//
// That is not hypothetical here. `0004` and `0005` relocated every rule and
// deleted `rule-tests/`, and the installed `README.md` and skill description
// went on naming the old tree for two releases. `0001` rewrites the README on
// every run, which sounds like it covers this and does not: migrations only run
// ABOVE the recorded version, so a project that is already current never
// rewrites anything. Reaching those projects took `0006`.
//
// So when you write a migration that changes this directory's shape:
//
// 1. Update whatever describes it. `0001`'s README body derives its layout
//    section from the rule layout table, so a table change carries; anything
//    written as prose does not.
// 2. Refresh this repository's own `.taskless/` and commit it, since we
//    install Taskless on ourselves. `installed-documentation.test.ts` fails
//    if you forget.
// 3. Ask whether already-current projects need the change. If they do, the
//    only thing that reaches them is a new version, because nothing below
//    the recorded one runs again.
//
// ---------------------------------------------------------------------------

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
 * What a migration WOULD do, without doing it.
 *
 * Read-only on purpose. A command that reports on a project must be able to
 * find out that the project is behind without changing it, and until this
 * existed the only way to learn the version was to run the migration that
 * changes it. That made a migration unverifiable by construction: comparing
 * findings before and after is impossible when asking the question performs
 * the change, so a migration that silently dropped a rule could not be caught
 * by the one check that would catch it.
 *
 * `undefined` means nothing is pending, which includes a project newer than
 * this CLI understands. That case is a different failure with its own message,
 * and it is {@link runMigrations}' to report.
 */
export async function pendingMigration(
  cwd: string
): Promise<{ from: number; to: number } | undefined> {
  const tasklessDirectory = join(cwd, ".taskless");
  // Keyed on the DIRECTORY, not the manifest. A `.taskless/` with no manifest
  // reads as version 0, which is behind — and it is exactly the case that must
  // not be waved through, because its tree is the pre-`0004` layout that a
  // current CLI finds no rules in. Waving it through would report "no rules
  // configured" for a project full of them, which is the silent answer this
  // whole change exists to stop giving.
  //
  // A project with no `.taskless/` at all has nothing to migrate and is not
  // this function's business.
  if (!(await pathExists(tasklessDirectory))) return undefined;
  const { version } = await readRawManifest(tasklessDirectory);
  if (version >= LATEST_SCHEMA_VERSION) return undefined;
  return { from: version, to: LATEST_SCHEMA_VERSION };
}

/**
 * Refuse to read a project whose scaffold is behind this CLI, and say what to
 * run.
 *
 * `check` and `verify` used to migrate as a precondition, which made two
 * read-only commands rewrite the repository: `0005` moves and deletes tracked
 * files, and it did so with no output on the human path unless someone was
 * reading stderr closely. The change landed in whatever commit came next, and
 * in CI it ran on every checkout.
 *
 * A wall the user hits once after an upgrade is the worse-sounding option and
 * the better one. It is visible, it happens when they are looking, and it is
 * the same trade this CLI already makes for an unsupported request and the
 * service makes for a client below the version floor: refuse, and name the
 * thing that fixes it.
 */
export async function requireCurrentSchema(cwd: string): Promise<void> {
  // BOTH directions. `check` used to reach `runMigrations` through
  // `ensureTasklessDirectory`, which is where the newer-than-this-CLI refusal
  // lived; it does not any more, so this is the only precondition left and it
  // has to carry that case too. Without it a version-99 scaffold read as
  // "nothing pending" and `check` reported "No rules configured" for a project
  // whose layout it simply could not parse — the same silent answer this
  // change exists to stop giving, reintroduced by the change itself.
  const tasklessDirectory = join(cwd, ".taskless");
  if (await pathExists(tasklessDirectory)) {
    const { version } = await readRawManifest(tasklessDirectory);
    if (version > LATEST_SCHEMA_VERSION && !hasVersionMismatchOverride()) {
      throw new CLIError(
        `This project's .taskless/ scaffold is version ${String(version)}, but this CLI only understands version ${String(LATEST_SCHEMA_VERSION)}. ` +
          `Upgrade the CLI to continue, or re-run with ${ALLOW_VERSION_MISMATCHES_FLAG} to proceed without migrating.`,
        "SCAFFOLD_VERSION_MISMATCH"
      );
    }
  }

  const pending = await pendingMigration(cwd);
  if (pending === undefined) return;
  throw new CLIError(
    `This project's .taskless/ is at schema version ${String(pending.from)}, and this ` +
      `CLI expects ${String(pending.to)}. Migrating moves and deletes files, so it is ` +
      `not done as a side effect of a command that only reads.\n\n` +
      `Run \`${buildInvocation()} init\` to migrate, then run this again.`,
    "SCAFFOLD_MIGRATION_REQUIRED"
  );
}

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
      // Write manifest at last successful version so we don't re-run
      // completed migrations. Re-read from disk so we preserve whatever
      // earlier successful migrations wrote (instead of writing back `raw`,
      // which is the pre-run snapshot and could clobber their output).
      if (v > version + 1) {
        // Only the READ is guarded, and only for the one failure it can now
        // produce. A manifest that became unreadable mid-run is left exactly
        // as it is: stamping a version over content this CLI cannot parse
        // would discard it, which is the data loss the read guard exists to
        // stop, and the migration failure rethrown below is the report that
        // matters. Everything else still propagates. Wrapping the write too
        // would swallow a permission or disk-full failure on the stamp, which
        // has nothing to do with readability and was visible before this
        // guard existed.
        let latestRaw: Record<string, unknown> | undefined;
        try {
          ({ raw: latestRaw } = await readRawManifest(tasklessDirectory));
        } catch (readError) {
          if (
            !(readError instanceof CLIError) ||
            readError.code !== "SCAFFOLD_MANIFEST_UNREADABLE"
          ) {
            throw readError;
          }
        }
        if (latestRaw !== undefined) {
          await writeRawManifest(tasklessDirectory, {
            ...latestRaw,
            version: v - 1,
          });
        }
      }
      // One string, one printer. This used to `console.error` the prefixed
      // message here and then rethrow the original, so whoever owns the
      // surface printed the same text a second time: once naming the
      // migration, once not (taskless/cli#389). Folding the prefix into the
      // rethrown message keeps the migration number — the only thing that
      // says WHICH migration refused, since a migration's own message names
      // paths and never itself — and leaves the printing to the one layer
      // that owns it: the top-level handler, the wizard, or a `--json`
      // envelope.
      //
      // Both branches end in a throw, unconditionally. The failure mode
      // opposite to a doubled line is swallowing, which would exit 0 and let
      // `init` report success over a half-migrated tree.
      if (error instanceof CLIError) {
        // `code` is carried through rather than re-coded: telemetry attributes
        // on it, and collapsing every migration failure to one code would
        // flatten `SCAFFOLD_CONFLICT` (a deliberate, actionable refusal) into
        // the same bucket as an unexpected fault. `reported` rides along so a
        // throw site that already showed the user something is still not
        // printed again.
        throw new CLIError(
          `Migration ${String(v)} failed: ${error.message}`,
          error.code,
          { reported: error.reported }
        );
      }
      // Deliberately a plain `Error`, not a `CLIError`: an unrecognized fault
      // should keep classifying as INTERNAL_ERROR, exactly as it did when the
      // original propagated. Only the message gains the prefix, and `cause`
      // keeps the original reachable for anything inspecting it.
      throw new Error(
        `Migration ${String(v)} failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  // Re-read the raw manifest so we preserve anything migrations wrote.
  //
  // This is also the write that used to destroy an unreadable manifest: the
  // re-read returned `{}` for a file it could not parse, and the stamp below
  // spread that over the top, so `{"version": 6, <<<<<<< HEAD ...}` came back
  // as `{"version": 6}`. The read throws now, so the stamp never happens over
  // content this CLI failed to understand.
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
