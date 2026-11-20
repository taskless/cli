import { lstat } from "node:fs/promises";
import { join } from "node:path";

import type { RuleViolation } from "../constraints";
import { engineRulesDirectory } from "../engines";
import { RULES_DIRECTORY, TASKLESS_DIRECTORY } from "../layout";

/**
 * Where a grammar directory would sit inside the Vale rules tree, relative to
 * the project root.
 *
 * The Vale rules tree is the StylesPath of every config the CLI assembles, and
 * Vale reads a grammar from `<StylesPath>/config/grammars/` in preference to
 * the pinned grammars named through `VALE_GRAMMARS_PATH`. A `vale sync` run
 * against an assembled config puts one exactly here.
 */
export const VALE_TREE_GRAMMARS = [
  TASKLESS_DIRECTORY,
  RULES_DIRECTORY,
  "vale",
  "config",
  "grammars",
].join("/");

/**
 * The violation a grammar directory in the Vale rules tree raises, or
 * `undefined` when there is none.
 *
 * Its presence is refused, not its contents: an empty directory today is a
 * populated one after the next `vale sync`, and any grammar in it would win
 * over the pinned one for that language. Shared by `validate`, which reports
 * it against every Vale rule, and by assembly, which refuses the `check` run,
 * so the two cannot disagree about what they found.
 */
export async function valeTreeGrammarsViolation(
  cwd: string
): Promise<RuleViolation | undefined> {
  const path = join(engineRulesDirectory(cwd, "vale"), "config", "grammars");
  const stats = await lstat(path).catch(() => {});
  if (stats === undefined) return undefined;
  return {
    constraintId: "vale-tree-no-grammars",
    message:
      `${VALE_TREE_GRAMMARS} holds Vale grammars the CLI did not ship. Vale ` +
      `would read them before the pinned grammars, so they are refused. ` +
      `Remove the directory.`,
  };
}
