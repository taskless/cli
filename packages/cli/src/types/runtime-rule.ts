/**
 * Runtime rule file format + harness↔check contract — mirrored structurally from
 * `@taskless/types` (workers/generator). A runtime rule is a DIRECTORY under
 * `.taskless/runtime/rules/<name>/`: one or more ast-grep capture `*.yml` plus
 * exactly one `check.ts`. The capture rules are the cheap syntactic narrow; the
 * `check.ts` refines only where the narrow matched.
 *
 * These types are kept structurally identical to what a generated `check.ts`
 * declares inline: a delivered check imports NOTHING from `@taskless/*`, so the
 * contract is structural, not an import. They exist here for the CLI's own
 * harness code (discovery, narrow, invocation).
 */

/** Harness↔check protocol version; bumped only on a breaking `(root, matches)` change. */
export const RUNTIME_CHECK_PROTOCOL_VERSION = 1;

/**
 * Finding severity — a subset of ast-grep's enum. `error` blocks (non-zero
 * result); `warning` and `info` are advisory. An omitted value is treated as
 * `warning`.
 */
export type FindingSeverity = "error" | "warning" | "info";

/** A single result a check returns. `file` is repo-root-relative. */
export interface Finding {
  /** Repo-root-relative path the finding is about. */
  file: string;
  /** 1-indexed line, when the finding is line-scoped. */
  line?: number;
  /** 1-indexed column, when the finding is column-scoped. */
  column?: number;
  /** Human-readable description of the finding. */
  message: string;
  /** Per-finding severity; an omitted value is treated as `warning`. */
  severity?: FindingSeverity;
}

/**
 * One normalized ast-grep match handed to a check. The check branches on `rule`
 * (the stable, model-assigned name), NEVER on `ruleId` (the baked-in hash).
 */
export interface Match {
  /** Stable, model-assigned capture-rule name to branch on (e.g. `exports`). */
  rule: string;
  /** Baked-in, globally-unique hashed id; opaque to the check. */
  ruleId: string;
  /** Path RELATIVE to `root`; `path.join(root, file)` to read the file. */
  file: string;
  /** 1-indexed line (ast-grep reports 0-indexed; the harness normalizes). */
  line: number;
  /** 1-indexed column (ast-grep reports 0-indexed; the harness normalizes). */
  column: number;
  /** The matched source text. */
  text: string;
  /** Captured metavariables by name; empty for a `broad` enumerator match. */
  captures: Record<string, string>;
}

/**
 * The harness↔check contract: a check module's default export is an async
 * function taking the repo `root` and the narrow's `matches`, reading any repo
 * file it needs from disk under `root`, and RETURNING its findings.
 */
export type CheckFunction = (
  root: string,
  matches: Match[]
) => Promise<Finding[]>;

/**
 * Scan mode for a capture rule. `anchor` (the default) is the syntactic narrow
 * (`ast-grep scan --json=stream`, matches carry `captures`); `broad` is a
 * whole-language enumerator (`rule: { kind: program }` + `--files-with-matches`,
 * paths only, empty `captures`).
 */
export type MatchMode = "anchor" | "broad";

/** The `metadata.taskless` block folded into every capture rule's YAML. */
export interface RuntimeRuleMetadata {
  /** Metadata schema version for the runtime rule format. */
  version: number;
  /** Discriminates a runtime capture rule from a static rule. */
  kind: "runtime";
  /** Stable, model-assigned capture-rule name (surfaced on matches as `rule`). */
  name: string;
  /** Filename of the `check.ts` this capture rule pairs with. */
  check: string;
  /** Scan mode; treated as `anchor` when omitted. */
  match?: MatchMode;
}

/** One on-disk ast-grep capture `*.yml` of a runtime rule. */
export interface CaptureRule {
  /** Baked-in, globally-unique ast-grep rule id (`${ruleSlug}-${sha1}`). */
  id?: string;
  /** ast-grep `language` — scopes which files this rule parses. */
  language: string;
  /** The ast-grep matcher. */
  rule: Record<string, unknown>;
  /** Optional ast-grep `constraints` — a SIBLING of `rule`, not nested. */
  constraints?: Record<string, unknown>;
  /** Optional ast-grep `utils` — a sibling of `rule`. */
  utils?: Record<string, unknown>;
  /** Optional ast-grep `transform` — a sibling of `rule`. */
  transform?: Record<string, unknown>;
  /** Taskless metadata folded into the YAML. */
  metadata: {
    /** The runtime rule's self-describing Taskless block. */
    taskless: RuntimeRuleMetadata;
    /** Other metadata keys are permitted alongside. */
    [key: string]: unknown;
  };
}
