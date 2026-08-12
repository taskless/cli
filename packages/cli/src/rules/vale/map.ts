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
 * Vale's *other* JSON payload: a configuration error.
 *
 * When a rule file is malformed, Vale emits one flat object like
 * `{Line, Path, Text: "'level' must be one of [...]", Code: "E201", Span}`
 * rather than findings-keyed-by-file.
 *
 * Measured against the real binary (a rule with an out-of-vocabulary `level`):
 * it goes to **stderr** with **exit 2** and an empty stdout, so `runVale`'s
 * non-zero-exit branch already reports it as a failure and this shape never
 * reaches the mapper today.
 *
 * This guard is therefore defensive, not a fix for a live bug. It is cheap and
 * worth keeping because the failure mode if Vale ever reports a config error on
 * stdout is not a wrong answer but a crash: mapping it walks `Object.entries`
 * over `Line`/`Path`/`Code` and calls `.map` on a number, and an uncaught throw
 * out of `runVale` would take the other engines down with it (D6b).
 */
export interface ValeConfigError {
  Code: string;
  Text: string;
  Path?: string;
  Line?: number;
}

/**
 * Recognize the config-error payload, so the caller can report it as a failure
 * rather than crashing while mapping it.
 *
 * Keyed on `Code` + `Text` because those are what distinguish it: a findings
 * payload's values are arrays, and its keys are file paths, so a top-level
 * string `Code` cannot occur in one.
 */
export function asValeConfigError(
  parsed: unknown
): ValeConfigError | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const candidate = parsed as Partial<ValeConfigError>;
  return typeof candidate.Code === "string" &&
    typeof candidate.Text === "string"
    ? (candidate as ValeConfigError)
    : undefined;
}

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
 * start and end share the line number.
 *
 * Both are converted down by one. `CheckResult.range` is 0-indexed — ast-grep's
 * native range is passed straight through by `toCheckResult`, the runtime
 * harness converts its 1-based `Finding` down the same way, and `format.ts` adds
 * 1 back for every source when it displays. Vale's `Line` and `Span` are both
 * 1-based, so emitting them verbatim would report every finding one line and one
 * column further into the file than it is. Clamped at 0 because a 0 from Vale
 * (unset, rather than a real position) must not become -1.
 */
export function toValeCheckResult(
  file: string,
  finding: ValeFinding
): CheckResult {
  const [spanStart, spanEnd] = finding.Span;
  const line = Math.max(0, finding.Line - 1);
  const startColumn = Math.max(0, spanStart - 1);
  const endColumn = Math.max(0, spanEnd - 1);
  return {
    source: "vale",
    ruleId: stripRulesPrefix(finding.Check),
    severity: normalizeSeverity(finding.Severity),
    message: finding.Message,
    note: toNote(finding),
    file,
    range: {
      start: { line, column: startColumn },
      end: { line, column: endColumn },
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
    // Defence in depth against the shape confusion {@link asValeConfigError}
    // guards: callers should reject a config-error payload before reaching
    // here, but a non-array value must never become a `.map` on a number.
    Array.isArray(findings)
      ? findings.map((finding) => toValeCheckResult(file, finding))
      : []
  );
}
