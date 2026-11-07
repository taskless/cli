import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  classifySchema,
  hasVersionMismatchOverride,
  runMigrations,
  schemaAheadError,
  schemaMigrationRequiredError,
  type MigrationReport,
  type SchemaState,
} from "./migrate";

export interface EnsureOptions {
  /**
   * Called TWICE when migrations run: once as the run starts, and once on
   * completion with the file-by-file summary. Callers that render their own
   * UI (e.g., the interactive wizard using clack) can use this to keep both
   * messages inside their visual tree. When omitted, the migration runner
   * falls back to writing them with `console.error`.
   *
   * Callers that emit `--json` should pass a callback that suppresses output
   * under that flag: the same information is on the envelope's `migrated`
   * field, and a machine consumer reading stderr gets prose it cannot parse.
   */
  onNotice?: (message: string) => void;
  /**
   * Proceed instead of throwing when `.taskless/` is newer than this CLI
   * understands. Defaults to whether `--allow-version-mismatches` is in argv.
   */
  allowVersionMismatches?: boolean;
}

/**
 * Ensure the .taskless/ directory exists and is up-to-date by running
 * any pending migrations. Safe to call repeatedly — returns immediately
 * if already current.
 *
 * This is the MECHANISM behind the `migrate` policy, not a policy of its own.
 * A command decides what to do with the scaffold through {@link ensureSchema};
 * calling this directly from a command migrates a behind scaffold whether or
 * not that command is meant to, which is how `onboard` and `report` came to.
 *
 * Returns the {@link MigrationReport} when migrations ran, so the command that
 * triggered them can say so in its own output, and `undefined` when the
 * scaffold was already current.
 */
export async function ensureTasklessDirectory(
  cwd: string,
  options: EnsureOptions = {}
): Promise<MigrationReport | undefined> {
  const tasklessDirectory = join(cwd, ".taskless");
  await mkdir(tasklessDirectory, { recursive: true });
  return runMigrations(tasklessDirectory, {
    onNotice: options.onNotice,
    allowVersionMismatches: options.allowVersionMismatches,
  });
}

/**
 * What a command is allowed to do to the scaffold. Every command that touches
 * `.taskless/` names one, so the answer is a decision someone made and not a
 * side effect of which helper the command happened to call.
 *
 * - `migrate`: create an absent scaffold and migrate a behind one. `init` and
 *   `update` (including the wizard) only; migrations move and delete tracked
 *   files, and those are the commands a person runs to have that happen.
 * - `scaffold-if-absent`: create an absent scaffold, refuse a behind one.
 *   Creating a fresh directory rewrites nothing, so a command that writes
 *   under `.taskless/` may still do it.
 * - `refuse`: change nothing. An absent scaffold is left absent, for a command
 *   with its own answer to "there is nothing here" (`check`), or one whose
 *   write path scaffolds later (the rule-writing commands).
 *
 * Every policy refuses a scaffold that is ahead of this CLI, unless the
 * version-mismatch override is set.
 */
export type SchemaPolicy = "migrate" | "refuse" | "scaffold-if-absent";

/** What {@link ensureSchema} found, and what it did about it. */
export interface EnsureSchemaResult {
  /** The scaffold's state BEFORE anything ran. */
  state: SchemaState;
  /** Set only when migrations ran, under `migrate` or `scaffold-if-absent`. */
  migrated?: MigrationReport;
}

/**
 * Bring the scaffold to the state a command needs, under that command's
 * policy, or throw the `CLIError` that says why not.
 *
 * Throws `SCAFFOLD_VERSION_MISMATCH` for an ahead scaffold without the
 * override, and `SCAFFOLD_MIGRATION_REQUIRED` for a behind one under any
 * policy but `migrate`. Both messages are built in `migrate.ts`, once.
 */
export async function ensureSchema(
  cwd: string,
  policy: SchemaPolicy,
  options: EnsureOptions = {}
): Promise<EnsureSchemaResult> {
  const state = await classifySchema(cwd);
  switch (state.kind) {
    case "current": {
      return { state };
    }
    case "ahead": {
      // Proceeding means reading, and under `migrate` writing, a layout this
      // CLI does not fully understand. That is what the override asks for, so
      // it is honoured under every policy; the caller gets `ahead` back and
      // can tell.
      if (options.allowVersionMismatches ?? hasVersionMismatchOverride()) {
        return { state };
      }
      throw schemaAheadError(state.version, state.supported);
    }
    case "behind": {
      if (policy !== "migrate") {
        throw schemaMigrationRequiredError(state.from, state.to);
      }
      return { state, migrated: await ensureTasklessDirectory(cwd, options) };
    }
    case "absent": {
      if (policy === "refuse") return { state };
      return { state, migrated: await ensureTasklessDirectory(cwd, options) };
    }
  }
}
