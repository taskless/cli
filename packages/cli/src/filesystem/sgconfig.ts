import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ensureTasklessDirectory } from "./directory";
import { ENGINE_LAYOUTS } from "../rules/engines";
import { COMMITTED_SG_CONFIG } from "../rules/scan";

/** Build sgconfig contents pointing `ruleDirs` at the given directory. */
function sgConfigContent(
  rulesDirectory: string,
  testDirectory: string
): string {
  return `ruleDirs:\n  - ${rulesDirectory}\ntestConfigs:\n  - testDir: ${testDirectory}\n`;
}

export interface SgConfigOptions {
  /**
   * Directory (relative to `.taskless/`) that ast-grep should load rules from.
   * Defaults to `sg/rules`, the engine-partitioned location. Callers pass the
   * legacy `rules` when scanning an unmigrated tree, and reconciliation points
   * this at the ephemeral run directory so only the server-blessed run set is
   * evaluated.
   */
  rulesDirectory?: string;
  /**
   * Directory (relative to `.taskless/`) holding that rule set's tests.
   * Defaults to `sg/rule-tests`. Only `sg test` reads it.
   */
  testDirectory?: string;
}

/**
 * Generate an ephemeral `sgconfig.yml` in `.taskless/` for ast-grep.
 * Runs migrations and ensures the directory structure is up-to-date.
 *
 * The `sg` engine no longer goes through here — it reads its committed
 * `sg/sgconfig.yml` ({@link COMMITTED_SG_CONFIG}). What remains is the rule
 * sets that have no committed config of their own: the pre-migration
 * `.taskless/rules/` layout, and the materialized run set under `.run/`.
 */
export async function generateSgConfig(
  cwd: string,
  options: SgConfigOptions = {}
): Promise<void> {
  await ensureTasklessDirectory(cwd);
  await writeFile(
    join(cwd, ".taskless", EPHEMERAL_SG_CONFIG_FILE),
    sgConfigContent(
      options.rulesDirectory ?? ENGINE_LAYOUTS.sg.rulesDirectory,
      options.testDirectory ?? ENGINE_LAYOUTS.sg.ruleTestsDirectory
    ),
    "utf8"
  );
}

/** Filename of the generated config, inside `.taskless/` (git-ignored). */
const EPHEMERAL_SG_CONFIG_FILE = "sgconfig.yml";

/** The generated config's path relative to the project root. */
export const EPHEMERAL_SG_CONFIG = `.taskless/${EPHEMERAL_SG_CONFIG_FILE}`;

/** A rule set to point ast-grep at, as returned by engine discovery. */
export interface SgConfigSource {
  /** Rules directory, relative to `.taskless/`. */
  rulesDirectory: string;
  /** Rule-tests directory, relative to `.taskless/`. */
  ruleTestsDirectory: string;
  /** Whether this is the pre-migration layout. */
  legacy: boolean;
}

/**
 * The `--config` path to run this rule set with, relative to the project root.
 *
 * The engine-partitioned source resolves to its committed config and nothing is
 * written. Only the legacy layout — which by definition predates that config —
 * still needs one generated for it.
 */
export async function resolveSgConfigPath(
  cwd: string,
  source: SgConfigSource
): Promise<string> {
  if (!source.legacy) return COMMITTED_SG_CONFIG;
  await generateSgConfig(cwd, {
    rulesDirectory: source.rulesDirectory,
    testDirectory: source.ruleTestsDirectory,
  });
  return EPHEMERAL_SG_CONFIG;
}
