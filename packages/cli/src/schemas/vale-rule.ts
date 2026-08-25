/**
 * The structural schema for a Vale style file, pinned to {@link VALE_VERSION}.
 *
 * Vale publishes no JSON Schema. Its repository has no `schemas/` directory,
 * and the machine-readable field knowledge exists only behind the hosted MCP
 * server at `api.vale.sh/mcp`, which is a paid product and unavailable to
 * `verify`. So unlike `ast-grep-rule.ts` — which runs `z.fromJSONSchema()` over
 * an upstream artifact fetched per tag — everything here is a
 * **transcription**, and a transcription drifts.
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
 *
 * ## Shape
 *
 * Two stages, in the order the binary itself works:
 *
 * 1. **The header.** Vale reads `extends`, `message` and `level` literally,
 *    before it decodes anything else, and gives up if they are wrong. `scope`
 *    rides along because it is common to all twelve checks and is a grammar
 *    rather than a value.
 * 2. **The check's own fields**, as a `z.discriminatedUnion` on `extends`.
 *    That is Vale's `E201` class expressed as schema shape: a strict object per
 *    check type, so a field belonging to another one is rejected by the union
 *    rather than by hand-written branching.
 *
 * Stage 2 runs only if stage 1 passed, which reproduces the binary: an
 * `extends` it does not recognize is reported on its own, because with no check
 * type there is no field table to check anything against.
 */

import { z } from "zod";

import { VALE_VERSION } from "../rules/capabilities";
import { schemaLayer, type SchemaLayerResult } from "./layer";

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
 * The keys Vale reads literally, before the case-insensitive field decode.
 *
 * Measured: `Tokens:` and `ignoreCase:` are read exactly as their lowercase
 * spellings, but `EXTENDS:` fails with "Missing the required 'extends' key" and
 * `Message:` with the same for `message`. `LEVEL: warning` is stranger still —
 * it reaches the field decode as `level`, which the header reader has already
 * removed, so it comes back as `E201 has invalid keys: 'level'`.
 *
 * {@link canonicalKeys} reproduces that split, which is why these three are
 * named as a set.
 */
const HEADER_KEYS = new Set(["extends", "message", "level"]);

// --- The scope grammar -------------------------------------------------------

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

const scopeVocabulary =
  `Accepted: ${VALE_SCOPE_OPERANDS.join(", ")} (each optionally prefixed ` +
  `with "~", chained with "&", or given as a list).`;

/**
 * Check one `scope` string, which is a small grammar rather than a value.
 *
 * Measured, the binary accepts a bare operand, a `~` negation, and operands
 * chained with `&` — `~code`, `[~code]`, and `text & ~code` all parse and
 * behave. An enum would reject every one of those, which is worse than the gap
 * it closes, so the enum applies to the *operands* and this walks the operators
 * around them.
 *
 * **A negation over an unrecognized operand is rejected as strictly as a bare
 * one, and that is a deliberate business rule rather than a transcription.**
 * `~fenced` does not fail: it fires on everything, because there is no `fenced`
 * to subtract. The binary "accepts" it in the only sense an exit code can
 * express, and what the author gets is a rule with its exclusion silently
 * deleted — the exact class of failure this module exists to catch.
 * `test/vale-corpus.ts` carries it as a recorded divergence rather than as a
 * row the differential quietly skips.
 */
function scopeMessages(scope: string): string[] {
  const messages: string[] = [];
  for (const part of scope.split("&")) {
    const negated = part.trim().startsWith("~");
    const operand = part.trim().replace(/^~/, "").trim();
    if (operand === "") {
      messages.push(`scope: empty operand in "${scope}".`);
      continue;
    }
    if (isScopeOperand(operand)) continue;
    messages.push(
      negated
        ? `scope: "~${operand}" negates a scope Vale ${VALE_VERSION} does ` +
            `not have, so it subtracts nothing and the rule fires everywhere — ` +
            `the exclusion you wrote it for is silently gone. Vale does not ` +
            `report this, so verify does. ${scopeVocabulary}`
        : `scope: "${operand}" is not a Vale ${VALE_VERSION} scope. Vale ` +
            `does not reject an unknown scope — the rule loads, runs, and ` +
            `matches nothing. ${scopeVocabulary}`
    );
  }
  return messages;
}

// --- Stage 1: the header -----------------------------------------------------

/**
 * A YAML mapping whose header keys Vale would accept.
 *
 * Everything here is checked against the **raw** keys, before
 * {@link canonicalKeys} lowercases anything, because these are the three keys
 * Vale reads literally.
 */
const valeHeaderSchema = z
  .record(z.string(), z.unknown(), {
    error: "the style file is not a YAML mapping.",
  })
  .check((context) => {
    const rule = context.value;
    const fail = (path: PropertyKey[], message: string): void => {
      context.issues.push({ code: "custom", input: rule, path, message });
    };

    const extendsValue = rule.extends;
    if (typeof extendsValue !== "string") {
      fail(["extends"], "missing the required 'extends' key.");
    } else if (
      !(VALE_CHECK_TYPES as readonly string[]).includes(extendsValue)
    ) {
      fail(
        ["extends"],
        `extends "${extendsValue}" is not a Vale ${VALE_VERSION} check type. ` +
          `Vale fails the whole run over this, taking every other Vale rule's ` +
          `findings with it. Accepted: ${VALE_CHECK_TYPES.join(", ")}.`
      );
    }

    if (typeof rule.message !== "string") {
      fail(["message"], "missing the required 'message' key.");
    }

    if (
      rule.level !== undefined &&
      (typeof rule.level !== "string" ||
        !(VALE_LEVELS as readonly string[]).includes(rule.level))
    ) {
      fail(
        ["level"],
        `level ${JSON.stringify(rule.level)} is not one of ` +
          `${VALE_LEVELS.join(", ")}.`
      );
    }

    // `scope` is common to all twelve checks, so it is stated once here rather
    // than repeated across every member of the union below.
    const { scope } = rule;
    if (scope === undefined) return;
    if (typeof scope !== "string" && !Array.isArray(scope)) {
      fail(["scope"], "scope must be a string or a list of strings.");
      return;
    }
    const operands = typeof scope === "string" ? [scope] : scope;
    for (const [index, entry] of operands.entries()) {
      if (typeof entry !== "string") {
        fail(
          ["scope", index],
          `scope[${String(index)}] must be a string, not ${typeof entry}.`
        );
        continue;
      }
      for (const message of scopeMessages(entry)) {
        fail(["scope", index], message);
      }
    }
  });

/**
 * Lowercase every field name Vale would lowercase, and no others.
 *
 * Vale decodes a check's own fields through a case-insensitive map, so
 * `Tokens:` and `ignoreCase:` are read exactly as their lowercase spellings and
 * must not be reported as unrecognized. The three header keys are the
 * exception: they are read literally and removed before the field decode, so a
 * differently-cased spelling is left alone here and falls through to the strict
 * object below — which is what Vale does with `LEVEL: warning`, reporting
 * `E201 has invalid keys: 'level'`.
 */
function canonicalKeys(rule: Record<string, unknown>): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rule)) {
    const lower = key.toLowerCase();
    canonical[HEADER_KEYS.has(lower) && key !== lower ? key : lower] = value;
  }
  return canonical;
}

// --- Stage 2: the per-check field tables -------------------------------------

/**
 * Fields every check accepts, whatever it extends.
 *
 * `vocab` is deliberately absent: five of the twelve reject it, so it is listed
 * per check instead. Values are `unknown` throughout — the binary decides what
 * a field's type means, and guessing here would be the "too strict" failure
 * against types nothing measured.
 */
const commonFields = {
  extends: z.string(),
  message: z.string(),
  level: z.string().optional(),
  scope: z.unknown(),
  link: z.unknown(),
  limit: z.unknown(),
  action: z.unknown(),
  description: z.unknown(),
  name: z.unknown(),
};

/** The field names above, for the message a rejected field gets. */
const COMMON_FIELD_NAMES = Object.keys(commonFields);

/**
 * One member of the union: the check's own fields, and nothing else.
 *
 * `z.strictObject` is what makes this worth doing — the `E201` class becomes a
 * property of the schema's shape rather than a hand-written key walk. The
 * custom `error` turns zod's "Unrecognized key" into the sentence an author can
 * act on, because the blast radius is the reason the check exists at all.
 */
function check(name: ValeCheckType, fields: readonly string[]) {
  const accepted = [...COMMON_FIELD_NAMES, ...fields].toSorted();
  return z.strictObject(
    {
      ...commonFields,
      extends: z.literal(name),
      ...Object.fromEntries(fields.map((field) => [field, z.unknown()])),
    },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? `${issue.keys.map((key) => `'${key}'`).join(", ")} ` +
            `${issue.keys.length === 1 ? "is not a field" : "are not fields"} ` +
            `of the ${name} check. Vale reports this as E201 and reads one ` +
            `config for the whole run, so it suppresses every other Vale ` +
            `rule's findings. ${name} accepts: ${accepted.join(", ")}.`
          : undefined,
    }
  );
}

/**
 * The two checks that validate nothing.
 *
 * Measured: `bananafield: true` on a `consistency` or a `spelling` rule loads
 * without complaint and is ignored. They do not use the strict decode the other
 * ten do, so the binary raises no `E201` for a foreign field there.
 *
 * `z.looseObject` follows the binary rather than the docs. Being strict here
 * would reject rules that work — the "too strict" direction — to catch a typo
 * that costs nothing but a rule quietly missing one of its own fields. The
 * recipe says so in prose, which is the only place it can be said.
 */
function permissiveCheck(name: ValeCheckType) {
  return z.looseObject({ ...commonFields, extends: z.literal(name) });
}

export const VALE_PERMISSIVE_CHECKS: readonly ValeCheckType[] = [
  "consistency",
  "spelling",
];

/**
 * The per-check field tables, measured by adding each candidate to a minimal
 * rule of that check and watching for `E201: has invalid keys`.
 *
 * Kept as a table rather than inlined into the union below, because this *is*
 * the measurement — the union is only how it gets enforced. Three entries
 * contradict Vale's published docs, and the binary wins: `capitalization` takes
 * `prefix` **singular** and rejects `prefixes` and `suffixes`; `capitalization`
 * rejects `ignorecase`; `occurrence` rejects `exceptions` and `vocab`.
 *
 * `consistency` and `spelling` are absent on purpose — see
 * {@link permissiveCheck}.
 */
const CHECK_FIELDS = {
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
} as const;

/**
 * The `E201` class, as schema shape.
 *
 * Ten strict objects and two loose ones, discriminated on `extends`, so a field
 * belonging to another check type is rejected by the union rather than by a
 * hand-written key walk. The members are spelled out rather than mapped over
 * {@link CHECK_FIELDS} so that each `z.literal` survives into {@link ValeRule}.
 */
const valeBodySchema = z.discriminatedUnion(
  "extends",
  [
    check("existence", CHECK_FIELDS.existence),
    check("substitution", CHECK_FIELDS.substitution),
    check("capitalization", CHECK_FIELDS.capitalization),
    check("occurrence", CHECK_FIELDS.occurrence),
    check("repetition", CHECK_FIELDS.repetition),
    check("conditional", CHECK_FIELDS.conditional),
    check("metric", CHECK_FIELDS.metric),
    check("readability", CHECK_FIELDS.readability),
    check("sequence", CHECK_FIELDS.sequence),
    check("script", CHECK_FIELDS.script),
    permissiveCheck("consistency"),
    permissiveCheck("spelling"),
  ],
  {
    // Unreachable in practice — the header rejects an unknown `extends` first,
    // with a message naming all twelve. Supplied so that if the two ever drift
    // apart the fallback is still a sentence rather than "Invalid input".
    error: () => `extends must be one of: ${VALE_CHECK_TYPES.join(", ")}.`,
  }
);

/** A Vale style file, as the schema understands one. */
export type ValeRule = z.infer<typeof valeBodySchema>;

/**
 * The whole rule: header, then the check's own fields.
 *
 * `.pipe` is doing the sequencing — zod runs the second stage only if the first
 * produced no issues, which is exactly the binary's behavior. An `extends` Vale
 * does not know, a missing `message`, or a bad `level` is reported on its own,
 * because none of them leaves a field table to check against.
 */
export const valeRuleSchema = valeHeaderSchema
  .transform(canonicalKeys)
  .pipe(valeBodySchema);

/** What the schema layer concluded. Shared with the ast-grep path. */
export type ValeSchemaResult = SchemaLayerResult;

/**
 * Validate a parsed Vale style file structurally, before Vale is invoked.
 *
 * Every message is already a full sentence naming its own field, so the
 * formatter only has to say which file it is about — unlike the ast-grep path,
 * where the upstream schema's generic messages need their path prepended.
 */
export function validateValeRule(
  ruleId: string,
  data: unknown
): ValeSchemaResult {
  return schemaLayer(
    valeRuleSchema.safeParse(data),
    (issue) => `${ruleId}.yml: ${issue.message}`
  );
}
