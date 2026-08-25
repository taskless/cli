/**
 * The structural schema for a Vale style file, pinned to {@link VALE_VERSION}.
 *
 * Vale publishes no JSON Schema. Its repository has no `schemas/` directory,
 * and the machine-readable field knowledge exists only behind the hosted MCP
 * server at `api.vale.sh/mcp`, which is a paid product and unavailable to
 * `verify`. So unlike `ast-grep-rule.ts` — which wraps an upstream artifact
 * fetched per tag — everything here is a **transcription**, and a transcription
 * drifts.
 *
 * What makes it trustworthy is not care in the writing. It is
 * `test/vale-corpus.ts`: a table of minimal rules, each with a document it must
 * flag, run through the vendored binary and through this module, asserting the
 * two agree. Every value enumerated below was measured accepted by the binary
 * that way. A Vale bump that changes the vocabulary fails that test naming the
 * field, rather than leaving this file quietly wrong.
 *
 * Two directions of error, and they are not symmetric:
 *
 * - **Too lax** — a rule the binary will not honor verifies clean. That is the
 *   gap this module exists to close.
 * - **Too strict** — a rule the binary accepts is rejected. That is worse: it
 *   blocks work that would have functioned. Where a measurement is ambiguous,
 *   accept.
 */

import { VALE_VERSION } from "../rules/capabilities";

/**
 * Vale's check types, quoted from the binary rather than the documentation.
 *
 * Obtained by giving Vale an `extends` it does not know, which is not silently
 * ignored — it fails the file, exits 2, and enumerates the set:
 *
 * ```
 * 'extends' key must be one of [capitalization conditional consistency
 * existence occurrence repetition substitution readability spelling sequence
 * metric script].
 * ```
 *
 * That settles the eleven-versus-twelve question the docs and Vale's own MCP
 * guide disagree on: **twelve**. The docs' eleven folds `readability` into
 * `metric`; the binary treats them as separate checks whose fields are
 * disjoint, and each rejects the other's.
 *
 * Sorted here rather than left in the binary's order, so the value `verify`
 * prints to an author reads predictably.
 */
export const VALE_CHECK_TYPES = [
  "capitalization",
  "conditional",
  "consistency",
  "existence",
  "metric",
  "occurrence",
  "readability",
  "repetition",
  "script",
  "sequence",
  "spelling",
  "substitution",
] as const;

export type ValeCheckType = (typeof VALE_CHECK_TYPES)[number];

/** Vale's three severities. The value is case-sensitive: `WARNING` is rejected. */
export const VALE_LEVELS = ["suggestion", "warning", "error"] as const;

/**
 * Fields every check accepts, whatever it extends.
 *
 * `vocab` is deliberately **not** here: five of the twelve reject it. It is
 * listed per check instead.
 */
const COMMON_FIELDS = [
  "extends",
  "message",
  "level",
  "scope",
  "link",
  "limit",
  "action",
  "description",
  "name",
] as const;

/**
 * The fields each check accepts beyond {@link COMMON_FIELDS}, measured by
 * adding each candidate to a minimal rule of that check and watching for
 * `E201: has invalid keys`.
 *
 * Three entries contradict Vale's published docs, and the binary wins:
 * `capitalization` takes `prefix` **singular** and rejects `prefixes` and
 * `suffixes`; `capitalization` rejects `ignorecase`; `occurrence` rejects
 * `exceptions` and `vocab`.
 *
 * `consistency` and `spelling` are absent on purpose — see
 * {@link VALE_PERMISSIVE_CHECKS}.
 */
const CHECK_FIELDS: Partial<Record<ValeCheckType, readonly string[]>> = {
  existence: [
    "tokens",
    "raw",
    "ignorecase",
    "nonword",
    "exceptions",
    "append",
    "vocab",
  ],
  substitution: [
    "swap",
    "ignorecase",
    "nonword",
    "exceptions",
    "capitalize",
    "pos",
    "vocab",
  ],
  capitalization: [
    "match",
    "style",
    "exceptions",
    "threshold",
    "indicators",
    "prefix",
    "vocab",
  ],
  occurrence: ["token", "max", "min", "ignorecase"],
  repetition: ["tokens", "alpha", "ignorecase", "exceptions", "max", "vocab"],
  conditional: ["first", "second", "exceptions", "ignorecase", "vocab"],
  metric: ["formula", "condition"],
  readability: ["metrics", "grade"],
  sequence: ["tokens", "ignorecase"],
  script: ["script"],
};

/**
 * The two checks that validate nothing.
 *
 * Measured: `bananafield: true` on a `consistency` or a `spelling` rule loads
 * without complaint and is ignored. They do not use the strict decode the other
 * ten do, so the binary raises no `E201` for a foreign field there.
 *
 * The schema follows the binary rather than the docs. Being strict here would
 * reject rules that work — the "too strict" direction — to catch a typo that
 * costs nothing but a rule quietly missing one of its own fields. The recipe
 * says so in prose, which is the only place it can be said.
 */
export const VALE_PERMISSIVE_CHECKS: readonly ValeCheckType[] = [
  "consistency",
  "spelling",
];

/**
 * The `scope` operands the binary was measured honoring.
 *
 * Each was established by authoring a rule with that scope over a document the
 * rule had to flag, and confirming the finding appeared. A scope that never
 * fired for any control is not here.
 *
 * This is the highest-value list in the module, because `scope` is the one
 * field nothing downstream ever validates. An unrecognized `extends` fails the
 * run loudly; an unrecognized field raises `E201`. An unrecognized **scope**
 * loads, runs, and matches nothing — no error, anywhere, ever.
 *
 * Note what is *not* here: `meta` and `meta.class.<kind>`. The v3.18.0 addition
 * is `frontmatter` / `frontmatter.<key>`, which is the vocabulary the binary
 * carries and the one that fires.
 */
const SCOPE_OPERANDS = new Set([
  "text",
  "code",
  "raw",
  "heading",
  "heading.h1",
  "heading.h2",
  "heading.h3",
  "heading.h4",
  "heading.h5",
  "heading.h6",
  "paragraph",
  "sentence",
  "list",
  "blockquote",
  "link",
  "alt",
  "summary",
  "strong",
  "emphasis",
  "table",
  "table.header",
  "table.cell",
  "table.caption",
  "figure.caption",
  "frontmatter",
  "comment",
  "comment.line",
  "comment.block",
]);

/**
 * Scope families whose tail is author-supplied and cannot be enumerated.
 *
 * `frontmatter.title` names a key in the document's own front matter;
 * `text.class.callout` names an HTML class. Both were measured firing, and
 * neither has a closed set — rejecting an unfamiliar tail would be the
 * "too strict" failure against a value the binary honors.
 */
const SCOPE_PREFIXES = ["frontmatter.", "text.class."];

/** Operands, for the message `verify` shows an author. */
export const VALE_SCOPE_OPERANDS: readonly string[] = [
  ...SCOPE_OPERANDS,
  "frontmatter.<key>",
  "text.class.<name>",
].toSorted();

function isScopeOperand(operand: string): boolean {
  if (SCOPE_OPERANDS.has(operand)) return true;
  return SCOPE_PREFIXES.some(
    (prefix) => operand.startsWith(prefix) && operand.length > prefix.length
  );
}

/**
 * Validate one `scope` string, which is a small grammar rather than a value.
 *
 * Measured, the binary accepts a bare operand, a `~` negation, and operands
 * chained with `&` — `~code`, `[~code]`, and `text & ~code` all parse and
 * behave. Modeling `scope` as a flat enum would reject every one of those,
 * which is worse than the gap it closes.
 *
 * **A negation over an unrecognized operand is checked as strictly as a bare
 * one, and that is a deliberate disagreement with the binary.** `~fenced` does
 * not fail — it fires on everything, because there is no `fenced` to subtract.
 * The binary "accepts" it in the only sense an exit code can express, and what
 * the author gets is a rule with its exclusion silently deleted. That is the
 * exact class of failure this module exists to catch, so it is rejected here.
 * `test/vale-corpus.ts` carries it as a recorded divergence rather than as a
 * row the differential quietly skips.
 */
function scopeErrors(scope: string, path: string): string[] {
  const errors: string[] = [];
  for (const part of scope.split("&")) {
    const operand = part.trim().replace(/^~/, "").trim();
    if (operand === "") {
      errors.push(`${path}: empty operand in "${scope}".`);
      continue;
    }
    if (!isScopeOperand(operand)) {
      errors.push(
        `${path}: "${operand}" is not a Vale ${VALE_VERSION} scope. ` +
          `Vale does not reject an unknown scope — the rule loads, runs, and ` +
          `matches nothing. Accepted: ${VALE_SCOPE_OPERANDS.join(", ")} ` +
          `(each optionally prefixed with "~", chained with "&", or given as ` +
          `a list).`
      );
    }
  }
  return errors;
}

/** What the schema layer concluded. Mirrors `LayerResult` in `rules/verify.ts`. */
export interface ValeSchemaResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a parsed Vale style file structurally, before Vale is invoked.
 *
 * The ordering matters: `extends` is resolved first, because every other
 * question depends on it. Without a known check type there is no field table to
 * check against, so the function reports that one error and stops rather than
 * inventing a second complaint from a table it does not have.
 *
 * Field names are compared **case-insensitively**, because Vale decodes them
 * that way — `Tokens:` and `ignoreCase:` are read exactly as their lowercase
 * spellings. The three header keys are the exception: Vale reads `extends`,
 * `message` and `level` literally, so `EXTENDS:` fails there with "Missing the
 * required 'extends' key", and this function reproduces that split.
 */
export function validateValeRule(
  ruleId: string,
  data: unknown
): ValeSchemaResult {
  const errors: string[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { valid: false, errors: [`${ruleId}.yml is not a YAML mapping.`] };
  }
  const rule = data as Record<string, unknown>;

  const extendsValue = rule.extends;
  if (typeof extendsValue !== "string") {
    errors.push(`${ruleId}.yml is missing the required 'extends' key.`);
  } else if (!(VALE_CHECK_TYPES as readonly string[]).includes(extendsValue)) {
    errors.push(
      `${ruleId}.yml: extends "${extendsValue}" is not a Vale ${VALE_VERSION} ` +
        `check type. Vale fails the whole run over this, taking every other ` +
        `Vale rule's findings with it. Accepted: ` +
        `${VALE_CHECK_TYPES.join(", ")}.`
    );
  }

  if (typeof rule.message !== "string") {
    errors.push(`${ruleId}.yml is missing the required 'message' key.`);
  }

  if (
    rule.level !== undefined &&
    (typeof rule.level !== "string" ||
      !(VALE_LEVELS as readonly string[]).includes(rule.level))
  ) {
    errors.push(
      `${ruleId}.yml has an invalid level; it must be ${VALE_LEVELS.join(", ")}.`
    );
  }

  const scope = rule.scope;
  if (typeof scope === "string") {
    errors.push(...scopeErrors(scope, `${ruleId}.yml: scope`));
  } else if (Array.isArray(scope)) {
    for (const [index, entry] of scope.entries()) {
      if (typeof entry === "string") {
        errors.push(...scopeErrors(entry, `${ruleId}.yml: scope[${index}]`));
      } else {
        errors.push(
          `${ruleId}.yml: scope[${index}] must be a string, not ${typeof entry}.`
        );
      }
    }
  } else if (scope !== undefined) {
    errors.push(`${ruleId}.yml: scope must be a string or a list of strings.`);
  }

  // Only once `extends` is known: the field table is keyed on it, and a check
  // type we do not have cannot say which fields are foreign.
  const check = extendsValue as ValeCheckType;
  const perCheck = CHECK_FIELDS[check];
  if (perCheck !== undefined && !VALE_PERMISSIVE_CHECKS.includes(check)) {
    const allowed = new Set(
      [...COMMON_FIELDS, ...perCheck].map((field) => field.toLowerCase())
    );
    for (const key of Object.keys(rule)) {
      if (!allowed.has(key.toLowerCase())) {
        errors.push(
          `${ruleId}.yml: '${key}' is not a field of the ${check} check. Vale ` +
            `reports this as E201 and reads one config for the whole run, so ` +
            `it suppresses every other Vale rule's findings. ${check} accepts: ` +
            `${[...COMMON_FIELDS, ...perCheck].toSorted().join(", ")}.`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
