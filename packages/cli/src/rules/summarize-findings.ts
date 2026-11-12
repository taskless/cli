import { relative, resolve } from "node:path";

import type { CheckSummary } from "../schemas/check";
import type { CheckResult } from "../types/check";
import { RUNTIME_SOURCE } from "./runtime/harness";

type Severity = CheckResult["severity"];
type RuleSummary = CheckSummary["rules"][number];
type Engine = NonNullable<RuleSummary["engine"]>;

/** The engine directory each finding `source` comes from. */
const ENGINE_OF_SOURCE: Record<string, Engine | undefined> = {
  "ast-grep": "sg",
  vale: "vale",
  [RUNTIME_SOURCE]: "runtime",
};

function zeroSeverities(): Record<Severity, number> {
  return { error: 0, warning: 0, info: 0, hint: 0 };
}

/**
 * Count `results` overall and per rule, for `check --json`'s `summary`.
 *
 * Grouped by `source` and `ruleId` together, never by id alone: two engines
 * can hold a rule with the same id, and folding them into one entry would
 * report a count neither rule has. Files are counted in one spelling relative
 * to `cwd`, so `./a.ts` and `a.ts` are one file.
 *
 * Only rules with findings appear. A rule with none is not listed, because
 * `results` cannot tell a rule that found nothing from one that did not run,
 * and a listed zero would claim the first.
 */
export function summarizeFindings(
  cwd: string,
  results: readonly CheckResult[]
): CheckSummary {
  const severities = zeroSeverities();
  const allFiles = new Set<string>();
  const byRule = new Map<
    string,
    { summary: RuleSummary; files: Set<string> }
  >();

  for (const result of results) {
    const file = relative(cwd, resolve(cwd, result.file));
    severities[result.severity]++;
    allFiles.add(file);

    const key = JSON.stringify([result.source, result.ruleId]);
    let entry = byRule.get(key);
    if (entry === undefined) {
      const engine = ENGINE_OF_SOURCE[result.source];
      entry = {
        summary: {
          ...(engine === undefined ? {} : { engine }),
          ruleId: result.ruleId,
          total: 0,
          files: 0,
          severities: zeroSeverities(),
        },
        files: new Set(),
      };
      byRule.set(key, entry);
    }
    entry.summary.total++;
    entry.summary.severities[result.severity]++;
    entry.files.add(file);
  }

  const rules = [...byRule.values()]
    .map(({ summary, files }) => ({ ...summary, files: files.size }))
    .toSorted(
      (a, b) =>
        b.total - a.total ||
        a.ruleId.localeCompare(b.ruleId) ||
        (a.engine ?? "").localeCompare(b.engine ?? "")
    );

  return {
    total: results.length,
    files: allFiles.size,
    severities,
    rules,
  };
}
