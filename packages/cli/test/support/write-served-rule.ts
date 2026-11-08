import type { ServedFileSet } from "../../src/api/v2";
import { ruleFilePath } from "../../src/rules/engines";
import { prepareServedRule, writePreparedRules } from "../../src/rules/files";

/**
 * Check, then write, one served rule the way `rule restore` and `rule
 * rollback` do: {@link prepareServedRule}, then {@link writePreparedRules}
 * with a one-rule list. Returns the rule file.
 *
 * A test helper rather than a production export, so every command keeps
 * writing through the one staged path and none can drift back to an in-place
 * write.
 */
export async function writeServedRule(
  cwd: string,
  fileSet: ServedFileSet,
  onWarning?: (message: string) => void
): Promise<string> {
  const prepared = prepareServedRule(cwd, fileSet, onWarning);
  await writePreparedRules(
    cwd,
    [prepared],
    onWarning === undefined
      ? undefined
      : (message) => {
          onWarning(message);
        }
  );
  return ruleFilePath(cwd, prepared.engine, prepared.id);
}
