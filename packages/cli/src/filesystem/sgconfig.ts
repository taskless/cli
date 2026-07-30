import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ensureTasklessDirectory } from "./directory";
import { ENGINE_LAYOUTS } from "../rules/engines";

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
 */
export async function generateSgConfig(
  cwd: string,
  options: SgConfigOptions = {}
): Promise<void> {
  await ensureTasklessDirectory(cwd);
  await writeFile(
    join(cwd, ".taskless", "sgconfig.yml"),
    sgConfigContent(
      options.rulesDirectory ?? ENGINE_LAYOUTS.sg.rulesDirectory,
      options.testDirectory ?? ENGINE_LAYOUTS.sg.ruleTestsDirectory
    ),
    "utf8"
  );
}
