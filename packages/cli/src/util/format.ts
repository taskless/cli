import type { CheckResult } from "../types/check";
import type { CheckSummary } from "../schemas/check";

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** `2 errors, 1 warning` from counts, in severity order, naming only nonzero. */
function describeCounts(counts: CheckSummary["severities"]): string {
  const parts: string[] = [];
  for (const severity of ["error", "warning", "info", "hint"] as const) {
    const count = counts[severity];
    if (count > 0) parts.push(plural(count, severity));
  }
  return parts.join(", ");
}

/** `2 errors, 1 warning` for a list of findings; see `describeCounts`. */
function describeSeverities(results: CheckResult[]): string {
  const counts: CheckSummary["severities"] = {
    error: 0,
    warning: 0,
    info: 0,
    hint: 0,
  };
  for (const result of results) counts[result.severity] += 1;
  return describeCounts(counts);
}

/**
 * Format results as human-readable diagnostic output.
 *
 * `hidden` is what the caller filtered out (findings below error, in CI). They
 * are never printed, only counted, so a run that hid them cannot read as one
 * that found nothing to hide.
 */
export function formatText(
  results: CheckResult[],
  hidden: CheckResult[] = []
): string {
  const hiddenLine =
    hidden.length === 0
      ? undefined
      : `${describeSeverities(hidden)} hidden in CI. Pass --include-warnings to show them.`;

  if (results.length === 0) {
    return hiddenLine === undefined
      ? "No issues found."
      : `No errors found. ${hiddenLine}`;
  }

  const lines: string[] = [];

  for (const result of results) {
    const location = `${result.file}:${String(result.range.start.line + 1)}:${String(result.range.start.column + 1)}`;
    lines.push(
      `  ${location}`,
      `  ${result.severity}[${result.ruleId}] ${result.message}`,
      `  > ${result.matchedText.split("\n")[0]}`
    );
    if (result.note) {
      lines.push(`  note: ${result.note}`);
    }
    lines.push("");
  }

  const uniqueFiles = new Set(results.map((r) => r.file)).size;
  lines.push(
    `${plural(results.length, "issue")} (${describeSeverities(results)}) across ${plural(uniqueFiles, "file")}`
  );
  if (hiddenLine !== undefined) lines.push(hiddenLine);

  return lines.join("\n");
}

/**
 * Format a run's per-rule counts, for `check --summary` without `--json`.
 *
 * Counts every severity, in CI too: nothing here is a finding to hide, and a
 * summary that dropped the warnings would undercount the rules it lists.
 */
export function formatSummaryText(summary: CheckSummary): string {
  if (summary.total === 0) return "No issues found.";

  const lines: string[] = [];
  for (const rule of summary.rules) {
    const name =
      rule.engine === undefined ? rule.ruleId : `${rule.engine}/${rule.ruleId}`;
    lines.push(
      `  ${name}: ${describeCounts(rule.severities)} across ${plural(rule.files, "file")}`
    );
  }
  lines.push(
    "",
    `${plural(summary.total, "issue")} (${describeCounts(summary.severities)}) from ${plural(summary.rules.length, "rule")} across ${plural(summary.files, "file")}`
  );
  return lines.join("\n");
}
