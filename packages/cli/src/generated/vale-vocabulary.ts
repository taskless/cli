/**
 * The Vale rule vocabulary, derived from the vendored binary.
 *
 * GENERATED FILE — DO NOT EDIT. Run `pnpm generate:vale-schema` in
 * `packages/cli` to reproduce it. The generator is
 * `scripts/generate-vale-schema.ts`, and its header explains what each value
 * below was measured with and what it is worth.
 *
 * Derived against Vale 3.18.0. Every value here is the recorded answer
 * of that binary to a rule the generator wrote and ran; nothing is transcribed
 * from documentation. Where the binary and the documentation disagree, the
 * disagreement is in `vale-vocabulary-report.md` rather than dropped.
 *
 * `src/schemas/vale-rule.ts` turns these into the zod schema `verify` runs.
 */

/** The binary this vocabulary was derived from. */
export const VALE_VOCABULARY_VERSION = "3.18.0";

/**
 * Vale's check types, self-enumerated: an unknown `extends` makes the binary
 * name the whole set, so this is discovered rather than proposed.
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

/**
 * Vale's severities, self-enumerated the same way, and left in the binary's
 * own order because that order is severity. The value is case-sensitive.
 */
export const VALE_LEVELS = ["suggestion", "warning", "error"] as const;

/**
 * The checks that accept any key at all and ignore what they do not know.
 *
 * Measured by offering each check a sentinel key no check has.
 */
export const VALE_PERMISSIVE_CHECKS = ["consistency", "spelling"] as const;

/**
 * The fields every strict check accepts, as the intersection of their measured
 * tables rather than as a declared list.
 *
 * Note what the intersection excludes: `vocab` is per-check, because several
 * checks reject it.
 */
export const VALE_COMMON_FIELDS = [
  "action",
  "description",
  "extends",
  "level",
  "limit",
  "link",
  "message",
  "name",
  "scope",
] as const;

/**
 * Each strict check's own fields — its measured table minus the common ones.
 *
 * Membership only: `E201` names the key you got wrong and never the ones you
 * could have used, so every name here was proposed by the generator's candidate
 * list and confirmed. A real field nobody proposed is absent.
 */
export const VALE_CHECK_FIELDS = {
  capitalization: [
    "exceptions",
    "indicators",
    "match",
    "prefix",
    "style",
    "threshold",
    "vocab",
  ],
  conditional: ["exceptions", "first", "ignorecase", "second", "vocab"],
  existence: [
    "append",
    "exceptions",
    "ignorecase",
    "nonword",
    "raw",
    "tokens",
    "vocab",
  ],
  metric: ["condition", "formula"],
  occurrence: ["ignorecase", "max", "min", "token"],
  readability: ["grade", "metrics"],
  repetition: ["alpha", "exceptions", "ignorecase", "max", "tokens", "vocab"],
  script: ["script"],
  sequence: ["ignorecase", "tokens"],
  substitution: [
    "capitalize",
    "exceptions",
    "ignorecase",
    "nonword",
    "pos",
    "swap",
    "vocab",
  ],
} as const;

/**
 * The `scope` operands measured firing on a fixture carrying their construct.
 *
 * `scope` has no oracle — an unknown scope is silent, and so is a valid scope
 * with no construct to match — so an operand is here only if a rule using it
 * flagged a fixture that a reach probe independently confirmed was linted.
 */
export const VALE_SCOPE_OPERANDS = [
  "alt",
  "blockquote",
  "code",
  "comment",
  "comment.block",
  "comment.line",
  "emphasis",
  "figure.caption",
  "frontmatter",
  "heading",
  "heading.h1",
  "heading.h2",
  "heading.h3",
  "heading.h4",
  "heading.h5",
  "heading.h6",
  "link",
  "list",
  "paragraph",
  "raw",
  "sentence",
  "strong",
  "summary",
  "table",
  "table.caption",
  "table.cell",
  "table.header",
  "text",
] as const;

/**
 * Scope families whose tail is author-supplied and cannot be enumerated.
 *
 * `frontmatter.title` names a key in the document's own front matter;
 * `text.class.callout` names an HTML class. Rejecting an unfamiliar tail would
 * be the too-strict failure against a value the binary honors.
 */
export const VALE_SCOPE_PREFIXES = ["frontmatter.", "text.class."] as const;

/**
 * Where Vale 3.18.0 and its documentation disagree.
 *
 * Carried in the artifact rather than only in the report, so that a consumer
 * can render them and a reviewer cannot miss them in a diff.
 */
export const VALE_DIVERGENCES = [
  {
    subject: "scope: meta",
    finding:
      "Vale 3.18.0 documents this operand and it never fired, on any fixture probed (.md).",
    consequence:
      "It is omitted from the vocabulary, so `verify` rejects it. A rule written from the documentation would otherwise load, run, and match nothing, with no error reported anywhere.",
  },
  {
    subject: "scope: meta.class.title",
    finding:
      "Vale 3.18.0 documents this operand and it never fired, on any fixture probed (.md).",
    consequence:
      "It is omitted from the vocabulary, so `verify` rejects it. A rule written from the documentation would otherwise load, run, and match nothing, with no error reported anywhere.",
  },
  {
    subject: "scope: frontmatter",
    finding: "This operand fired and Vale 3.18.0 documents it nowhere.",
    consequence:
      "It is included in the vocabulary. It is also the standing counterexample to trusting the candidate list: a real operand nobody proposes is simply absent, and the schema then rejects a rule the binary honors.",
  },
  {
    subject: "scope: frontmatter.title",
    finding: "This operand fired and Vale 3.18.0 documents it nowhere.",
    consequence:
      "It is included in the vocabulary. It is also the standing counterexample to trusting the candidate list: a real operand nobody proposes is simply absent, and the schema then rejects a rule the binary honors.",
  },
  {
    subject: "extends: consistency",
    finding:
      "This check accepted 'taskless_generator_sentinel', a key no check has. It does not validate its keys at all.",
    consequence:
      "The schema is permissive here. Being strict would reject rules the binary runs, to catch a typo that costs nothing but a field quietly ignored — the too-strict direction, which is the worse failure.",
  },
  {
    subject: "extends: spelling",
    finding:
      "This check accepted 'taskless_generator_sentinel', a key no check has. It does not validate its keys at all.",
    consequence:
      "The schema is permissive here. Being strict would reject rules the binary runs, to catch a typo that costs nothing but a field quietly ignored — the too-strict direction, which is the worse failure.",
  },
  {
    subject: "field probes: membership inferred from a type complaint",
    finding:
      "10 probes drew an E201 that was not an invalid-key list: capitalization.action: expected a map, got 'bool'; conditional.action: expected a map, got 'bool'; existence.action: expected a map, got 'bool'; metric.action: expected a map, got 'bool'; occurrence.action: expected a map, got 'bool'; readability.action: expected a map, got 'bool'; repetition.action: expected a map, got 'bool'; script.action: expected a map, got 'bool'; sequence.action: expected a map, got 'bool'; substitution.action: expected a map, got 'bool'.",
    consequence:
      "Each is recorded as a member: Vale recognized the key and objected to the probe's arbitrary value instead, which is membership evidence. They are listed so the inference is auditable rather than assumed.",
  },
] as const;
