import type { CheckResult } from "../../types/check";

/**
 * One finding as Vale emits it under `--output=JSON`.
 *
 * Field names are Vale's, capitalized, and are kept verbatim rather than
 * normalized on the way in — a renamed field then fails to parse here instead
 * of silently arriving as `undefined` three layers down.
 */
export interface ValeFinding {
  Check: string;
  Severity: string;
  Message: string;
  Description?: string;
  Link?: string;
  Line: number;
  /** `[start, end]` columns, 1-based. */
  Span: [number, number];
  Match: string;
  Action?: { Name?: string; Params?: string[] | null };
}

/** Vale's whole payload: findings keyed by the path they were found in. */
export type ValeOutput = Record<string, ValeFinding[]>;

/**
 * Vale's severities, normalized to the scanner-agnostic set.
 *
 * `suggestion → hint` is the only one that renames. Vale's three levels do not
 * include `info`, so nothing maps to it; a level we do not recognize becomes
 * `warning` rather than being dropped, because a finding whose severity we
 * cannot read is still a finding.
 */
export function normalizeSeverity(severity: string): CheckResult["severity"] {
  switch (severity.toLowerCase()) {
    case "error": {
      return "error";
    }
    case "warning": {
      return "warning";
    }
    case "suggestion": {
      return "hint";
    }
    default: {
      return "warning";
    }
  }
}

/**
 * Strip the `rules.` prefix Vale prepends to every check in our StylesPath.
 *
 * The style directory is named `rules`, so Vale reports `rules.no-simply` for
 * what Taskless calls `no-simply`. Stripping it here keeps `ruleId` the same
 * identity a user wrote, filed under, and sees from ast-grep — the prefix is an
 * artifact of Vale's config layout, not part of the rule's name.
 */
export function stripRulesPrefix(check: string): string {
  return check.startsWith("rules.") ? check.slice("rules.".length) : check;
}

/**
 * `Description` and `Link` both carry supporting detail, and either may be
 * empty. Joined rather than picked so a rule that sets only one still surfaces
 * it, and `undefined` when neither is set so the field stays absent rather than
 * empty-stringed.
 */
function toNote(finding: ValeFinding): string | undefined {
  const parts = [finding.Description, finding.Link].filter(
    (part): part is string => typeof part === "string" && part.trim() !== ""
  );
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * A fix, but only from an action that actually carries a replacement.
 *
 * Vale's actions are a small vocabulary (`replace`, `remove`, `edit`, …) and
 * only `replace` names the text to substitute. The others describe an edit
 * whose result is not in the payload, so there is nothing honest to put in
 * `fix`; emitting the action's name there would offer the user a "fix" that
 * replaces their match with the word "remove".
 */
function toFix(finding: ValeFinding): string | undefined {
  const action = finding.Action;
  if (action?.Name !== "replace") return undefined;
  const replacement = action.Params?.[0];
  return typeof replacement === "string" ? replacement : undefined;
}

/**
 * Map one Vale finding to the scanner-agnostic {@link CheckResult}.
 *
 * `range` collapses to a single line: Vale reports `Line` plus a `Span` of
 * columns within it, and has no concept of a finding that crosses lines, so
 * start and end share the line number. `Span` is 1-based and inclusive, which
 * matches what ast-grep already emits for `column`.
 */
export function toValeCheckResult(
  file: string,
  finding: ValeFinding
): CheckResult {
  const [startColumn, endColumn] = finding.Span;
  return {
    source: "vale",
    ruleId: stripRulesPrefix(finding.Check),
    severity: normalizeSeverity(finding.Severity),
    message: finding.Message,
    note: toNote(finding),
    file,
    range: {
      start: { line: finding.Line, column: startColumn },
      end: { line: finding.Line, column: endColumn },
    },
    matchedText: finding.Match,
    fix: toFix(finding),
  };
}

/**
 * Flatten Vale's whole payload into `CheckResult`s.
 *
 * Vale keys findings by path, so the file name lives on the outside and has to
 * be pushed down onto each finding.
 */
export function toValeCheckResults(output: ValeOutput): CheckResult[] {
  return Object.entries(output).flatMap(([file, findings]) =>
    (findings ?? []).map((finding) => toValeCheckResult(file, finding))
  );
}
