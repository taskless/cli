import { relative, resolve } from "node:path";

import type { CheckResult } from "../types/check";
import type { Findings } from "./types";

/**
 * What the rules find in the code today, counted by the CLI.
 *
 * All-or-nothing. tskl.es publishes `findings` only when every written rule
 * carries a count, and a total that silently skipped a rule would be a number
 * the reader cannot interpret. So either the CLI has a defensible count for
 * every rule it was given, or it reports none and says why.
 */

/** A rule the count is asked to cover. */
export interface CountedRule {
  id: string;
  engine: "sg" | "vale" | "runtime";
}

export type Measurement =
  | { measured: true; perRule: Map<string, Findings>; findings: Findings }
  | { measured: false; reason: string };

export function countFindings(options: {
  cwd: string;
  rules: CountedRule[];
  /** Plan and dispatch failures: any one means a rule may not have run. */
  failures: string[];
  results: CheckResult[];
}): Measurement {
  const { cwd, rules, failures, results } = options;

  // Reports are published logged out, so a runtime rule never runs here.
  const runtime = rules.filter((rule) => rule.engine === "runtime");
  if (runtime.length > 0) {
    return {
      measured: false,
      reason: `runtime rules do not run for a report: ${runtime.map((rule) => rule.id).join(", ")}`,
    };
  }
  if (failures.length > 0) {
    return {
      measured: false,
      reason: `the scan did not complete: ${failures.join("; ")}`,
    };
  }

  const files = new Map<string, Set<string>>(
    rules.map((rule) => [rule.id, new Set()])
  );
  const violations = new Map<string, number>(rules.map((rule) => [rule.id, 0]));
  const allFiles = new Set<string>();
  const unattributed = new Set<string>();
  for (const result of results) {
    const ruleFiles = files.get(result.ruleId);
    if (ruleFiles === undefined) {
      // ast-grep reports under the `id:` in the rule body. When that differs
      // from the directory, counting on would publish a confident 0 for the
      // rule while its real hits sat under a name nothing in the report has.
      unattributed.add(result.ruleId);
      continue;
    }
    // One spelling per file, so `./a.ts` and `a.ts` are counted once.
    const file = relative(cwd, resolve(cwd, result.file));
    ruleFiles.add(file);
    allFiles.add(file);
    violations.set(result.ruleId, (violations.get(result.ruleId) ?? 0) + 1);
  }
  if (unattributed.size > 0) {
    return {
      measured: false,
      reason: `results named rules the report does not have: ${[...unattributed].join(", ")}`,
    };
  }

  const perRule = new Map<string, Findings>(
    rules.map((rule) => [
      rule.id,
      {
        violations: violations.get(rule.id) ?? 0,
        files: files.get(rule.id)?.size ?? 0,
      },
    ])
  );
  let total = 0;
  for (const { violations: count } of perRule.values()) total += count;
  return {
    measured: true,
    perRule,
    findings: { violations: total, files: allFiles.size },
  };
}
