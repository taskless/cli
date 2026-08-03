import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ensureTasklessDirectory } from "./directory";
import { SG_RULES_DIRECTORY, SG_RULE_TESTS_DIRECTORY } from "./layout";

/** Build sgconfig contents pointing `ruleDirs` at the given directory. */
function sgConfigContent(rulesDirectory: string): string {
  return `ruleDirs:\n  - ${rulesDirectory}\ntestConfigs:\n  - testDir: ${SG_RULE_TESTS_DIRECTORY}\n`;
}

export interface SgConfigOptions {
  /**
   * Directory (relative to `.taskless/`) that ast-grep should load rules from.
   * Defaults to the `sg` engine directory. Reconciliation points this at the
   * ephemeral run directory so only the server-blessed run set is evaluated.
   */
  rulesDirectory?: string;
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
    sgConfigContent(options.rulesDirectory ?? SG_RULES_DIRECTORY),
    "utf8"
  );
}
