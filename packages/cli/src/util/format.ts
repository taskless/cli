import type { CheckResult } from "../types/check";
import type { CheckSummary } from "../schemas/check";

/** `2 errors, 1 warning`, in severity order, naming only the ones present. */
function describeSeverities(results: CheckResult[]): string {
  const counts: Record<string, number> = {};
  for (const result of results) {
    counts[result.severity] = (counts[result.severity] ?? 0) + 1;
  }

  const parts: string[] = [];
  for (const severity of ["error", "warning", "info", "hint"] as const) {
    const count = counts[severity];
    if (count !== undefined) {
      parts.push(`${String(count)} ${severity}${count === 1 ? "" : "s"}`);
    }
  }
  return parts.join(", ");
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
    `${String(results.length)} issue${results.length === 1 ? "" : "s"} (${describeSeverities(results)}) across ${String(uniqueFiles)} file${uniqueFiles === 1 ? "" : "s"}`
  );
  if (hiddenLine !== undefined) lines.push(hiddenLine);

  return lines.join("\n");
}

/** `2 errors, 1 warning` from counts, in severity order, naming only nonzero. */
function describeCounts(counts: CheckSummary["severities"]): string {
  const parts: string[] = [];
  for (const severity of ["error", "warning", "info", "hint"] as const) {
    const count = counts[severity];
    if (count > 0) {
      parts.push(`${String(count)} ${severity}${count === 1 ? "" : "s"}`);
    }
  }
  return parts.join(", ");
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
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
