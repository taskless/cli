/**
 * The corpus that makes `src/schemas/vale-rule.ts` true.
 *
 * The schema is a hand transcription — Vale publishes no JSON Schema, and the
 * machine-readable field knowledge sits behind its paid hosted MCP. What makes
 * a transcription trustworthy is not care in the writing; it is this table.
 * Every entry is a minimal rule plus a document the rule must flag, run through
 * **both** the vendored binary and the schema in
 * `vale-schema-contract.test.ts`, asserting the two agree.
 *
 * ## Why a verdict is not an exit code
 *
 * Vale does not report "this is not a scope". An unrecognized `scope` parses
 * clean and produces a rule that matches nothing — from outside, identical to a
 * valid rule whose pattern did not fire. So there are **three** outcomes, not
 * two:
 *
 * | Verdict      | What the binary did                                     |
 * | ------------ | ------------------------------------------------------- |
 * | `accepted`   | the rule fired on its control                           |
 * | `ignored`    | exit 0, no finding — the construct was silently dropped |
 * | `rejected`   | the run failed (`E201` or a key/value error)            |
 *
 * `ignored` is the verdict the whole change exists for, and it is the one that
 * can be produced accidentally. A control document with no table makes a
 * `scope: table.cell` entry read `ignored` when the scope is perfectly valid —
 * an entry that "passes" while asserting nothing. Two guards, both in the test:
 *
 * 1. **Reach.** A `scope: raw` existence rule over `simply` must fire on every
 *    control, which is why every control document below contains that word. It
 *    proves the document reached Vale at all — right extension, parseable
 *    format, matched glob — independently of the construct under test.
 * 2. **Attribution.** Every `ignored` entry carries a `proof`: the same rule
 *    with the construct replaced by a known-valid one, which must fire on the
 *    same control. Only then is "did not fire" attributable to the construct
 *    rather than to the fixture.
 *
 * Guard 1 is not theoretical. `figure.caption` first measured `ignored`,
 * because Vale drops everything inside a `<figure>` element — so did a
 * `scope: text` control over the same document. Without the reach guard the
 * operand would have been dropped from the schema as one Vale ignores, and
 * every rule using it would then have failed `verify`.
 *
 * ## Keep it a table
 *
 * A Vale upgrade should be a re-run, not a re-authoring, and a gap in coverage
 * should be visible as a missing row rather than as an absent test nobody
 * notices. Add rows; do not add per-case tests.
 */

/** What the vendored binary was measured doing with the construct. */
export type ValeVerdict = "accepted" | "ignored" | "rejected";

export interface ValeCorpusEntry {
  /** Stable identifier, printed by a failing differential. */
  name: string;
  /** The construct under test, in the failure message's words. */
  construct: string;
  /** The complete style file. */
  rule: string;
  /** The document the rule must flag when the construct is valid. */
  control: string;
  /** Extension of the control document; decides which parser Vale runs. */
  ext?: string;
  /**
   * Required for `ignored`: the same rule with the construct replaced by a
   * known-valid one. It must fire, or "did not fire" proves nothing.
   */
  proof?: string;
  /** The measured verdict. */
  expected: ValeVerdict;
  /**
   * A deliberate disagreement with the binary, and why. The differential
   * asserts the *disagreement* for these rows rather than agreement, so an
   * exception is a row you can count rather than a silent carve-out.
   */
  divergence?: string;
}

// --- Rule builders -----------------------------------------------------------
// Small enough that the table below stays readable, mechanical enough that a
// row still says exactly what it tests.

const existence = (extra = "", token = "simply"): string =>
  `extends: existence\nmessage: "x %s"\nlevel: warning\n${extra}tokens:\n  - ${token}\n`;

/** An existence rule at some scope. The only variable is the scope. */
const scoped = (scope: string): string => existence(`scope: ${scope}\n`);

/** The known-valid variant every `ignored` scope row is attributed against. */
const SCOPE_PROOF = scoped("raw");

// --- Control documents -------------------------------------------------------
// Every one contains `simply`, so the reach guard can be generated rather than
// written per row.

const PROSE = "Just simply do it.\n";
const INLINE_CODE = "Run `simply now` here.\n";
const THREE_PLACES = "Prose simply.\n\n```\nsimply fenced\n```\n";
const MIXED = "Prose simply here and `simply code`.\n";
const HEADINGS = "# Do simply things\n\n## Another simply heading\n";
const TABLE = "| Head |\n| --- |\n| simply |\n";
const FRONTMATTER = "---\ntitle: simply meta\n---\n\nBody text here.\n";
const JS_COMMENTS = "// simply line\n/*\n simply block\n*/\nconst x = 1;\n";

const heading = (level: number): string =>
  `${"#".repeat(level)} Level ${String(level)} simply heading\n`;

// --- The corpus --------------------------------------------------------------

/**
 * Every check type Vale accepts, each with a control it fires on, plus the
 * rejection of one it does not.
 *
 * The twelfth row is the point of the group: the docs enumerate eleven,
 * folding `readability` into `metric`, and the binary does not.
 */
const CHECK_TYPES: ValeCorpusEntry[] = [
  {
    name: "extends/existence",
    construct: "extends: existence",
    rule: existence(),
    control: PROSE,
    expected: "accepted",
  },
  {
    name: "extends/substitution",
    construct: "extends: substitution",
    rule: 'extends: substitution\nmessage: "x %s %s"\nlevel: warning\nswap:\n  utilize: use\n',
    control: "We utilize it simply.\n",
    expected: "accepted",
  },
  {
    name: "extends/occurrence",
    construct: "extends: occurrence",
    rule: 'extends: occurrence\nmessage: "x"\nlevel: warning\nscope: sentence\ntoken: very\nmax: 1\n',
    control: "It is very very very good, simply put.\n",
    expected: "accepted",
  },
  {
    name: "extends/consistency",
    construct: "extends: consistency",
    rule: 'extends: consistency\nmessage: "x %s"\nlevel: warning\neither:\n  advisor: adviser\n',
    control: "The advisor spoke simply. The adviser left.\n",
    expected: "accepted",
  },
  {
    name: "extends/conditional",
    construct: "extends: conditional",
    rule:
      'extends: conditional\nmessage: "x %s"\nlevel: warning\nscope: text\nignorecase: false\n' +
      "first: '\\b([A-Z]{3,5})\\b'\nsecond: '(?:\\b[A-Z][a-z]+ )+\\(([A-Z]{3,5})\\)'\n",
    control: "The ABC is here simply and nobody defined it.\n",
    expected: "accepted",
  },
  {
    name: "extends/capitalization",
    construct: "extends: capitalization",
    rule: 'extends: capitalization\nmessage: "x %s"\nlevel: warning\nscope: heading\nmatch: $title\nstyle: AP\n',
    control: "# this is a simply heading of things\n",
    expected: "accepted",
  },
  {
    name: "extends/metric",
    construct: "extends: metric",
    rule: 'extends: metric\nmessage: "x"\nlevel: warning\nformula: |\n  (characters / words)\ncondition: "> 1"\n',
    control: "Antidisestablishmentarianism prevails simply everywhere.\n",
    expected: "accepted",
  },
  {
    name: "extends/spelling",
    construct: "extends: spelling",
    rule: 'extends: spelling\nmessage: "x %s"\nlevel: warning\n',
    control: "This is definately speled simply wrongly.\n",
    expected: "accepted",
  },
  {
    name: "extends/readability",
    construct: "extends: readability",
    rule: 'extends: readability\nmessage: "x %s"\nlevel: warning\nmetrics:\n  - Gunning Fog\ngrade: 1\n',
    control:
      "The multifaceted epistemological ramifications of antidisestablishmentarianism, " +
      "notwithstanding their considerable complexity, remain fundamentally incomprehensible " +
      "to the uninitiated observer who lacks the requisite philosophical grounding. This is " +
      "simply not an accessible document by any conventional measurement.\n",
    expected: "accepted",
  },
  {
    name: "extends/script",
    construct: "extends: script",
    rule:
      'extends: script\nmessage: "x"\nlevel: warning\nscript: |\n' +
      '  text := import("text")\n  matches := []\n  for i, line in text.split(scope, "\\n") {\n' +
      '    idx := text.index(line, "badword")\n    if idx > -1 {\n' +
      "      matches = append(matches, {begin: idx, end: idx + 7})\n    }\n  }\n",
    control: "This has a badword in it, simply put.\n",
    expected: "accepted",
  },
  {
    name: "extends/sequence",
    construct: "extends: sequence",
    rule: 'extends: sequence\nmessage: "x"\nlevel: warning\nignorecase: true\ntokens:\n  - pattern: a\n  - tag: NN\n',
    control: "This is a dog and a simply cat.\n",
    expected: "accepted",
  },
  {
    name: "extends/repetition",
    construct: "extends: repetition",
    rule: "extends: repetition\nmessage: \"x '%s'\"\nlevel: warning\nalpha: true\ntokens:\n  - '[^\\s]+'\n",
    control: "This is is a simply test.\n",
    expected: "accepted",
  },
  {
    name: "extends/unknown",
    construct: "extends: nonsense",
    rule: 'extends: nonsense\nmessage: "x"\nlevel: warning\ntokens:\n  - simply\n',
    control: PROSE,
    expected: "rejected",
  },
  {
    name: "extends/wrong-case",
    construct: "extends: Existence",
    rule: 'extends: Existence\nmessage: "x"\nlevel: warning\ntokens:\n  - simply\n',
    control: PROSE,
    expected: "rejected",
  },
];

/** Every `scope` operand the schema enumerates, each on a control it reaches. */
const SCOPES: ValeCorpusEntry[] = [
  { name: "scope/text", scope: "text", control: PROSE },
  { name: "scope/code", scope: "code", control: INLINE_CODE },
  { name: "scope/raw", scope: "raw", control: THREE_PLACES },
  { name: "scope/heading", scope: "heading", control: HEADINGS },
  { name: "scope/heading.h1", scope: "heading.h1", control: heading(1) },
  { name: "scope/heading.h2", scope: "heading.h2", control: heading(2) },
  { name: "scope/heading.h3", scope: "heading.h3", control: heading(3) },
  { name: "scope/heading.h4", scope: "heading.h4", control: heading(4) },
  { name: "scope/heading.h5", scope: "heading.h5", control: heading(5) },
  { name: "scope/heading.h6", scope: "heading.h6", control: heading(6) },
  {
    name: "scope/paragraph",
    scope: "paragraph",
    control: "A simply paragraph here.\n",
  },
  {
    name: "scope/sentence",
    scope: "sentence",
    control: "A simply sentence here.\n",
  },
  { name: "scope/list", scope: "list", control: "- simply one\n- two\n" },
  {
    name: "scope/blockquote",
    scope: "blockquote",
    control: "> A simply quote.\n",
  },
  {
    name: "scope/link",
    scope: "link",
    control: "See [simply link](https://example.com).\n",
  },
  { name: "scope/alt", scope: "alt", control: "![simply alt text](x.png)\n" },
  {
    name: "scope/summary",
    scope: "summary",
    control:
      "<details><summary>simply summary</summary>\n\nbody\n\n</details>\n",
  },
  {
    name: "scope/strong",
    scope: "strong",
    control: "This is **simply bold** text.\n",
  },
  {
    name: "scope/emphasis",
    scope: "emphasis",
    control: "This is *simply italic* text.\n",
  },
  { name: "scope/table", scope: "table", control: TABLE },
  {
    name: "scope/table.header",
    scope: "table.header",
    control: "| simply |\n| --- |\n| body |\n",
  },
  { name: "scope/table.cell", scope: "table.cell", control: TABLE },
  {
    name: "scope/table.caption",
    scope: "table.caption",
    control:
      "<table><caption>simply caption</caption><tr><td>body</td></tr></table>\n",
    ext: "html",
  },
  {
    // Bare, not nested in <figure>: Vale drops everything inside that element,
    // including from `scope: text` and `scope: raw`. See the module comment.
    name: "scope/figure.caption",
    scope: "figure.caption",
    control: "<figcaption>simply caption</figcaption>\n",
    ext: "html",
  },
  { name: "scope/frontmatter", scope: "frontmatter", control: FRONTMATTER },
  {
    name: "scope/frontmatter.<key>",
    scope: "frontmatter.title",
    control: FRONTMATTER,
  },
  {
    name: "scope/text.class.<name>",
    scope: "text.class.foo",
    control: '<html><body><p class="foo">simply here</p></body></html>\n',
    ext: "html",
  },
  { name: "scope/comment", scope: "comment", control: JS_COMMENTS, ext: "js" },
  {
    name: "scope/comment.line",
    scope: "comment.line",
    control: "// simply line\nconst x = 1;\n",
    ext: "js",
  },
  {
    name: "scope/comment.block",
    scope: "comment.block",
    control: "/*\n simply block\n*/\nconst x = 1;\n",
    ext: "js",
  },
  // The operators. `scope` is a grammar, not an enum: a flat enum would reject
  // every one of these, which is worse than the gap the schema closes.
  { name: "scope/negation", scope: "~code", control: MIXED },
  { name: "scope/chain", scope: "text & ~code", control: MIXED },
].map(({ name, scope, control, ext }) => ({
  name,
  construct: `scope: ${scope}`,
  rule: scoped(scope),
  control,
  ...(ext === undefined ? {} : { ext }),
  expected: "accepted" as const,
}));

/** The list form, which cannot go through `scoped()`. */
const SCOPE_LISTS: ValeCorpusEntry[] = [
  {
    name: "scope/list-form",
    construct: "scope: [code, text]",
    rule: existence("scope:\n  - code\n  - text\n"),
    control: MIXED,
    expected: "accepted",
  },
  {
    name: "scope/list-form-negated",
    construct: "scope: [~code]",
    rule: existence("scope:\n  - ~code\n"),
    control: MIXED,
    expected: "accepted",
  },
];

/**
 * Scopes the binary silently drops. This is the failure the change exists for:
 * exit 0, no error, a rule that is inert forever.
 *
 * Each carries a `proof` — the same rule at `scope: raw` — so "did not fire" is
 * attributable to the scope and not to the fixture.
 */
const INVALID_SCOPES: ValeCorpusEntry[] = [
  { name: "scope/fenced", scope: "fenced", control: THREE_PLACES },
  { name: "scope/nonsense", scope: "banana", control: PROSE },
  { name: "scope/heading.h7", scope: "heading.h7", control: heading(1) },
  { name: "scope/table.row", scope: "table.row", control: TABLE },
  // Named by Vale's own docs and by this change's first draft. It does not
  // exist: the v3.18.0 addition is `frontmatter`, above.
  { name: "scope/meta", scope: "meta", control: FRONTMATTER },
  { name: "scope/meta.class", scope: "meta.class.title", control: FRONTMATTER },
].map(({ name, scope, control }) => ({
  name,
  construct: `scope: ${scope}`,
  rule: scoped(scope),
  control,
  proof: SCOPE_PROOF,
  expected: "ignored" as const,
}));

/**
 * The one place the schema deliberately disagrees with the binary.
 *
 * `~fenced` does not fail — it fires on everything, because there is no
 * `fenced` to subtract. The binary "accepts" it in the only sense an exit code
 * can express, and what the author gets is a rule whose exclusion was silently
 * deleted. Rejecting it is the whole point of the module, so the row asserts
 * the disagreement rather than hiding it in a skip list.
 */
const DIVERGENCES: ValeCorpusEntry[] = [
  {
    name: "scope/negated-unknown",
    construct: "scope: ~fenced",
    rule: scoped("~fenced"),
    control: MIXED,
    expected: "accepted",
    divergence:
      "A negation over an operand Vale does not know is a no-op: the rule " +
      "fires on everything, having silently lost the exclusion it was written " +
      "for. The schema rejects it.",
  },
];

/**
 * Per-check fields: one foreign field per strict check, and the valid fields
 * whose absence from an earlier draft would have blocked real rules.
 *
 * A foreign field is `E201`, and Vale reads one assembled config per run — so
 * this is the defect with the widest blast radius, taking every other Vale
 * rule's findings down with it.
 */
const FIELDS: ValeCorpusEntry[] = [
  // Foreign fields.
  {
    name: "field/existence+swap",
    construct: "swap on an existence check",
    rule: existence("swap:\n  utilize: use\n"),
    control: PROSE,
    expected: "rejected",
  },
  {
    name: "field/substitution+tokens",
    construct: "tokens on a substitution check",
    rule: 'extends: substitution\nmessage: "x %s %s"\nlevel: warning\nswap:\n  utilize: use\ntokens:\n  - simply\n',
    control: "We utilize it simply.\n",
    expected: "rejected",
  },
  {
    name: "field/occurrence+tokens",
    construct: "tokens on an occurrence check",
    rule: 'extends: occurrence\nmessage: "x"\nlevel: warning\nscope: sentence\ntoken: very\nmax: 1\ntokens:\n  - simply\n',
    control: "It is very very very good, simply put.\n",
    expected: "rejected",
  },
  {
    name: "field/capitalization+tokens",
    construct: "tokens on a capitalization check",
    rule: 'extends: capitalization\nmessage: "x %s"\nlevel: warning\nscope: heading\nmatch: $title\nstyle: AP\ntokens:\n  - simply\n',
    control: "# this is a simply heading of things\n",
    expected: "rejected",
  },
  {
    name: "field/capitalization+prefixes",
    construct: "prefixes (plural) on a capitalization check",
    rule: 'extends: capitalization\nmessage: "x %s"\nlevel: warning\nscope: heading\nmatch: $title\nstyle: AP\nprefixes:\n  - "Note: "\n',
    control: "# this is a simply heading of things\n",
    expected: "rejected",
  },
  {
    name: "field/occurrence+exceptions",
    construct: "exceptions on an occurrence check",
    rule: 'extends: occurrence\nmessage: "x"\nlevel: warning\nscope: sentence\ntoken: very\nmax: 1\nexceptions:\n  - Foo\n',
    control: "It is very very very good, simply put.\n",
    expected: "rejected",
  },
  {
    name: "field/metric+tokens",
    construct: "tokens on a metric check",
    rule: 'extends: metric\nmessage: "x"\nlevel: warning\nformula: |\n  (characters / words)\ncondition: "> 1"\ntokens:\n  - simply\n',
    control: "Antidisestablishmentarianism prevails simply everywhere.\n",
    expected: "rejected",
  },
  {
    name: "field/readability+formula",
    construct: "formula on a readability check",
    rule: 'extends: readability\nmessage: "x"\nlevel: warning\nmetrics:\n  - Gunning Fog\ngrade: 1\nformula: |\n  (characters / words)\n',
    control: "This document is simply written.\n",
    expected: "rejected",
  },
  {
    name: "field/sequence+swap",
    construct: "swap on a sequence check",
    rule: 'extends: sequence\nmessage: "x"\nlevel: warning\ntokens:\n  - pattern: a\n  - tag: NN\nswap:\n  utilize: use\n',
    control: "This is a dog and a simply cat.\n",
    expected: "rejected",
  },
  {
    name: "field/repetition+swap",
    construct: "swap on a repetition check",
    rule: "extends: repetition\nmessage: \"x '%s'\"\nlevel: warning\nalpha: true\ntokens:\n  - '[^\\s]+'\nswap:\n  utilize: use\n",
    control: "This is is a simply test.\n",
    expected: "rejected",
  },
  {
    name: "field/script+tokens",
    construct: "tokens on a script check",
    rule: 'extends: script\nmessage: "x"\nlevel: warning\nscript: |\n  matches := []\ntokens:\n  - simply\n',
    control: PROSE,
    expected: "rejected",
  },
  {
    name: "field/conditional+tokens",
    construct: "tokens on a conditional check",
    rule:
      'extends: conditional\nmessage: "x %s"\nlevel: warning\nscope: text\n' +
      "first: '\\b([A-Z]{3,5})\\b'\nsecond: '(?:\\b[A-Z][a-z]+ )+\\(([A-Z]{3,5})\\)'\ntokens:\n  - simply\n",
    control: "The ABC is here simply.\n",
    expected: "rejected",
  },
  // Valid fields. Each of these would be rejected by a schema that transcribed
  // the docs' common header and stopped there, which is the "too strict"
  // failure — worse than the gap being closed, because it blocks work.
  {
    name: "field/existence+nonword",
    construct: "nonword on a punctuation-only token",
    rule: existence("nonword: true\n", "'—'"),
    control: "This is simply a sentence — with an em dash.\n",
    expected: "accepted",
  },
  {
    name: "field/existence+limit",
    construct: "limit",
    rule: existence("limit: 1\n"),
    control: PROSE,
    expected: "accepted",
  },
  {
    name: "field/existence+vocab",
    construct: "vocab",
    rule: existence("vocab: false\n"),
    control: PROSE,
    expected: "accepted",
  },
  {
    name: "field/existence+link",
    construct: "link",
    rule: existence("link: https://example.com\n"),
    control: PROSE,
    expected: "accepted",
  },
  {
    name: "field/existence+mixed-case-key",
    construct: "Tokens, spelled with a capital",
    rule: 'extends: existence\nmessage: "x %s"\nlevel: warning\nTokens:\n  - simply\n',
    control: PROSE,
    expected: "accepted",
  },
  {
    name: "field/capitalization+prefix",
    construct: "prefix (singular) on a capitalization check",
    rule: 'extends: capitalization\nmessage: "x %s"\nlevel: warning\nscope: heading\nmatch: $title\nstyle: AP\nprefix: "Note: "\n',
    control: "# this is a simply heading of things\n",
    expected: "accepted",
  },
  {
    name: "field/occurrence+min",
    construct: "min on an occurrence check",
    rule: 'extends: occurrence\nmessage: "x"\nlevel: warning\nscope: sentence\ntoken: very\nmax: 1\nmin: 1\n',
    control: "It is very very very good, simply put.\n",
    expected: "accepted",
  },
  {
    name: "field/substitution+exceptions",
    construct: "exceptions on a substitution check",
    rule: 'extends: substitution\nmessage: "x %s %s"\nlevel: warning\nswap:\n  utilize: use\nexceptions:\n  - Foo\n',
    control: "We utilize it simply.\n",
    expected: "accepted",
  },
  // Strict versus permissive, asked the same way of all three candidates, with
  // a key no check has rather than a real field borrowed from another one.
  //
  // `sequence` belongs with the strict ten, and the row exists because that is
  // easy to get wrong: probe a *tokenless* sequence rule and Vale panics
  // instead of reporting, so a probe grepping for `has invalid keys` scores it
  // as permissive. Give the rule its `tokens` and it rejects the unknown key
  // like every other strict check. See `shape/sequence-without-tokens` below.
  {
    name: "field/sequence+unknown",
    construct: "an unknown field on a sequence check",
    rule: 'extends: sequence\nmessage: "x"\nlevel: warning\ntokens:\n  - pattern: a\n  - tag: NN\nbananafield: true\n',
    control: "This is a dog and a simply cat.\n",
    expected: "rejected",
  },
  // The two checks that really do validate nothing. A schema that was strict
  // here would reject rules the binary runs happily.
  {
    name: "field/consistency+unknown",
    construct: "an unknown field on a consistency check",
    rule: 'extends: consistency\nmessage: "x %s"\nlevel: warning\nbananafield: true\neither:\n  advisor: adviser\n',
    control: "The advisor spoke simply. The adviser left.\n",
    expected: "accepted",
  },
  {
    name: "field/spelling+unknown",
    construct: "an unknown field on a spelling check",
    rule: 'extends: spelling\nmessage: "x %s"\nlevel: warning\nbananafield: true\n',
    control: "This is definately speled simply wrongly.\n",
    expected: "accepted",
  },
];

/**
 * Shapes that panic the binary.
 *
 * Every key in these rules is a legal field of its check — it is the *shape*
 * that is fatal. Measured, each ends the process with a Go stack trace. The
 * `sequence` rows panic while the rule is compiled:
 *
 * ```
 * panic: interface conversion: interface {} is nil, not []interface {}
 * ```
 *
 * and the `metric` rows panic later, while the rule runs on a document:
 *
 * ```
 * panic: interface conversion: interface {} is float64, not bool
 * ```
 *
 * That is a wider blast radius than `E201`. An `E201` names a file and a line;
 * a panic names no rule at all, produces no findings for anything in the
 * project, and gives an author nothing to act on. `verify` is the last place
 * these can be caught.
 *
 * They are also a standing warning about how these measurements are taken. A
 * panic contains no `has invalid keys` string, so any probe that greps for that
 * phrase reads a panicking rule as *accepted* — which is exactly how a
 * tokenless `sequence` rule came to look like proof that `sequence` validates
 * nothing. The verdict below comes from the exit status, not from a grep.
 */
const SHAPES: ValeCorpusEntry[] = [
  {
    name: "shape/sequence-without-tokens",
    construct: "a sequence check with no tokens",
    rule: 'extends: sequence\nmessage: "x"\nlevel: warning\n',
    control: "This is a dog and a simply cat.\n",
    expected: "rejected",
  },
  {
    name: "shape/sequence-tokens-not-a-list",
    construct: "a sequence check whose tokens is not a list",
    rule: 'extends: sequence\nmessage: "x"\nlevel: warning\ntokens: simply\n',
    control: "This is a dog and a simply cat.\n",
    expected: "rejected",
  },
  {
    name: "shape/metric-formula-without-condition",
    construct: "a metric check with a formula and no condition",
    rule: 'extends: metric\nmessage: "x"\nlevel: warning\nformula: |\n  (characters / words)\n',
    control: "Antidisestablishmentarianism prevails simply everywhere.\n",
    expected: "rejected",
  },
  // The two rows below are the same panic reached through a *present* key, and
  // they are why the schema's guard is structural rather than a check for
  // `undefined`. `condition:` with nothing after the colon is the likelier of
  // the two to be typed by hand, and YAML hands it over as null, not as a
  // missing key.
  {
    name: "shape/metric-condition-null",
    construct: "a metric check whose condition key has no value",
    rule: 'extends: metric\nmessage: "x"\nlevel: warning\nformula: |\n  (characters / words)\ncondition:\n',
    control: "Antidisestablishmentarianism prevails simply everywhere.\n",
    expected: "rejected",
  },
  {
    name: "shape/metric-condition-blank",
    construct: "a metric check whose condition is a blank string",
    rule: 'extends: metric\nmessage: "x"\nlevel: warning\nformula: |\n  (characters / words)\ncondition: "   "\n',
    control: "Antidisestablishmentarianism prevails simply everywhere.\n",
    expected: "rejected",
  },
];

/** The header keys, which Vale reads literally rather than case-insensitively. */
const HEADER: ValeCorpusEntry[] = [
  {
    name: "header/level-unknown",
    construct: "level: bananas",
    rule: 'extends: existence\nmessage: "x"\nlevel: bananas\ntokens:\n  - simply\n',
    control: PROSE,
    expected: "rejected",
  },
  {
    name: "header/level-wrong-case",
    construct: "level: WARNING",
    rule: 'extends: existence\nmessage: "x"\nlevel: WARNING\ntokens:\n  - simply\n',
    control: PROSE,
    expected: "rejected",
  },
  {
    name: "header/missing-message",
    construct: "no message key",
    rule: "extends: existence\nlevel: warning\ntokens:\n  - simply\n",
    control: PROSE,
    expected: "rejected",
  },
  {
    name: "header/missing-extends",
    construct: "no extends key",
    rule: 'message: "x"\nlevel: warning\ntokens:\n  - simply\n',
    control: PROSE,
    expected: "rejected",
  },
  {
    name: "header/extends-wrong-case-key",
    construct: "EXTENDS, spelled with capitals",
    rule: 'EXTENDS: existence\nmessage: "x"\nlevel: warning\ntokens:\n  - simply\n',
    control: PROSE,
    expected: "rejected",
  },
];

export const VALE_CORPUS: readonly ValeCorpusEntry[] = [
  ...CHECK_TYPES,
  ...SCOPES,
  ...SCOPE_LISTS,
  ...INVALID_SCOPES,
  ...DIVERGENCES,
  ...FIELDS,
  ...SHAPES,
  ...HEADER,
];

/** The reach guard's rule: it must fire on every control in the corpus. */
export const REACH_PROBE = existence("scope: raw\nnonword: true\n");
