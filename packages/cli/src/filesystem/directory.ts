import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { runMigrations, type MigrationReport } from "./migrate";

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
