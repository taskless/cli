import { relative } from "node:path";

import type { CheckResult } from "../../types/check";
import type { Finding } from "../../types/runtime-rule";
import type { RuntimeRule } from "./discover";
import { runNarrow } from "./narrow";
import { DEFAULT_CHECK_TIMEOUT_MS, invokeCheck } from "./invoke";

/** Scanner-agnostic `source` label for runtime-rule findings. */
export const RUNTIME_SOURCE = "taskless-runtime";

/**
 * What `--dangerously-run-scripts` says when it is what let the code run.
 *
 * Stated beside the executor rather than in either command, because `check` and
 * `test` reach the flag by different routes — `check` through the reconcile
 * plan, `test` with no plan at all — and the sentence a user reads should not
 * depend on which route ran. Two spellings would drift, and the drift would be
 * invisible: both are warnings nobody diffs.
 */
export const RUN_SCRIPTS_WARNING =
  "Warning: --dangerously-run-scripts is executing runtime rule code without server verification.";

/** Options controlling a runtime-rule run. */
export interface RuntimeRunOptions {
  /** Restrict the narrow to these paths (diff scope); empty scans the repo. */
  paths?: string[];
  /** Per-check wall-clock bound in ms. */
  timeoutMs?: number;
}

/**
 * Map a check `Finding` onto the scanner-agnostic `CheckResult`. `Finding`
 * line/column are 1-indexed (harness contract); `CheckResult.range` is 0-indexed
 * (ast-grep native — display and `--json` consumers add 1), so convert down.
 */
function findingToCheckResult(
  rule: RuntimeRule,
  finding: Finding
): CheckResult {
  const line = finding.line === undefined ? 0 : Math.max(0, finding.line - 1);
  const column =
    finding.column === undefined ? 0 : Math.max(0, finding.column - 1);
  return {
    source: RUNTIME_SOURCE,
    ruleId: rule.name,
    severity: finding.severity ?? "warning",
    message: finding.message,
    file: finding.file,
    range: { start: { line, column }, end: { line, column } },
    matchedText: "",
  };
}

/** A harness failure (throw / timeout / bad output) becomes one error finding. */
function harnessErrorResult(
  root: string,
  rule: RuntimeRule,
  message: string
): CheckResult {
  return {
    source: RUNTIME_SOURCE,
    ruleId: rule.name,
    severity: "error",
    message: `runtime rule ${rule.name} failed: ${message}`,
    file: relative(root, rule.checkFile),
    range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
    matchedText: "",
  };
}

/**
 * One run of a rule against one root, with the facts a caller cannot recover
 * from the findings alone.
 *
 * `findings` is exactly what {@link executeRuntimeRule} returns, so the scan
 * path is unchanged. The other two fields carry what an empty array hides:
 *
 * - `invoked` says whether `check.ts` ran at all. The narrow gates it, so a
 *   root with no matches produces `[]` having never reached the check, which is
 *   indistinguishable downstream from a check that ran and found nothing. A
 *   scan does not care — both mean "nothing to report about this tree" — but a
 *   fixture case does, in BOTH buckets: a `fail/` case in that state is a
 *   fixture that never reached the check rather than a rule that stopped
 *   firing, and a `pass/` case in that state proves the narrow did not match
 *   rather than that the check stays quiet.
 * - `failure` says the harness itself broke — the narrow threw, or the check
 *   threw, timed out, or returned unusable output. Downstream that is also
 *   zero findings from the check's point of view, and only one of the two is
 *   the rule's fault.
 */
export interface RuntimeExecution {
  /** The findings, mapped exactly as the scan path receives them. */
  findings: CheckResult[];
  /** Whether `check.ts` was actually invoked. */
  invoked: boolean;
  /** Set when the narrow or the check failed, rather than found nothing. */
  failure?: string;
}

/**
 * Execute one runtime rule and report what happened, not only what it found.
 *
 * This is the single execution path. {@link executeRuntimeRule} is a thin
 * projection of it, so the narrow runs once, `check.ts` is invoked once, and
 * "did it run" has one source of truth rather than a scan and a fixture runner
 * each deciding for themselves. A harness failure is isolated to a single
 * error-severity finding and never throws.
 */
export async function executeRuntimeRuleDetailed(
  root: string,
  rule: RuntimeRule,
  options: RuntimeRunOptions = {}
): Promise<RuntimeExecution> {
  let matches;
  try {
    matches = await runNarrow(root, rule, options.paths ?? []);
  } catch (error) {
    const message = `narrow failed: ${error instanceof Error ? error.message : String(error)}`;
    return {
      findings: [harnessErrorResult(root, rule, message)],
      invoked: false,
      failure: message,
    };
  }

  // gate: no matches, no check. The gate is the reason `invoked` exists.
  if (matches.length === 0) return { findings: [], invoked: false };

  const result = await invokeCheck(
    rule.checkFile,
    root,
    matches,
    options.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS
  );
  if (result.status === "error") {
    return {
      findings: [harnessErrorResult(root, rule, result.message)],
      invoked: true,
      failure: result.message,
    };
  }
  return {
    findings: result.findings.map((finding) =>
      findingToCheckResult(rule, finding)
    ),
    invoked: true,
  };
}

/**
 * Execute one runtime rule: run the ast-grep narrow, gate on matches (zero
 * matches ⇒ `check.ts` is never invoked), invoke `check.ts`, and map its
 * findings onto `CheckResult`. A harness failure is isolated to a single
 * error-severity finding and never throws.
 */
export async function executeRuntimeRule(
  root: string,
  rule: RuntimeRule,
  options: RuntimeRunOptions = {}
): Promise<CheckResult[]> {
  const execution = await executeRuntimeRuleDetailed(root, rule, options);
  return execution.findings;
}

/**
 * Execute runtime rules in sequence (process-per-check scheduling) and return
 * the aggregated findings. Sequential keeps `tsx` worker startup predictable;
 * the function contract leaves room for a pool later.
 */
export async function executeRuntimeRules(
  root: string,
  rules: RuntimeRule[],
  options: RuntimeRunOptions = {}
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const rule of rules) {
    results.push(...(await executeRuntimeRule(root, rule, options)));
  }
  return results;
}
