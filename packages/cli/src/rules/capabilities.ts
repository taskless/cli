/**
 * What the two local engines can actually read.
 *
 * PURE DATA, DELIBERATELY. This module is imported by `src/prompts/recipes.ts`,
 * which is a Worker-safe library surface — no citty, no telemetry, no
 * filesystem, no network — and `assert-prompts-graph` in `vite.config.ts`
 * fails the build if the prompts chunk's graph reaches a host capability. So
 * nothing here may read `package.json`, spawn a binary, or import a node
 * builtin. The values are transcribed once, here, and pinned by tests that do
 * spawn the binaries.
 *
 * THE BINARIES ARE THE ONLY AUTHORITY, and neither of them can be asked at
 * render time:
 *
 * - `src/generated/ast-grep-rule-schema.json` types `$defs.Language` as a bare
 *   string with no enum — its only hint is an `example` reading `"typescript"`,
 *   which is not even the canonical spelling — so the vendored schema cannot
 *   answer the question. `verify` answers it from the constants below instead
 *   (see `validateLanguage` in `verify.ts`).
 * - `detect --json` reports the *repository's* languages in a different
 *   vocabulary — `C++` where ast-grep says `Cpp` — and says nothing about what
 *   an engine can parse.
 * - Vale self-reports nothing at all. Its reach was measured by probing the
 *   shipped binary, which is why the Vale constants below carry a probe-shaped
 *   contract test rather than a parsed capability listing.
 *
 * BUMPING AN ENGINE IS A ONE-FILE EDIT. Change the version constant and the
 * list beside it; `test/ast-grep-vendor-contract.test.ts` and
 * `test/vale-vendor-contract.test.ts` fail until the two agree, which is the
 * whole point of transcribing rather than describing. See taskless/cli#151 for
 * the routing miss this exists to prevent: two GitHub Actions workflow rules
 * were escalated to `runtime` because nothing said ast-grep parses YAML.
 */

/**
 * The ast-grep release pinned in `packages/cli/package.json`, both for
 * `@ast-grep/cli` and for every `@ast-grep/cli-<platform>` optional dependency.
 *
 * Pinned against the binary by `test/ast-grep-vendor-contract.test.ts`
 * ("engine capabilities" → "reports the pinned version").
 */
export const AST_GREP_VERSION = "0.45.2";

/**
 * Every language ast-grep can parse, verbatim from
 * `sg run -h` → `Supported languages are: [...]` at
 * {@link AST_GREP_VERSION}.
 *
 * SPELLINGS ARE ast-grep's, NOT ours and not `detect`'s. `Cpp`, `CSharp`,
 * `JavaScript`, `Tsx` — a rule's `language:` field is handed to ast-grep
 * unchanged, so the binary has the final opinion. MEASURED at 0.45.2: it
 * accepts more than this list — case variants and a fixed set of extension
 * aliases, both enumerated in {@link AST_GREP_LANGUAGE_ALIASES} — so an
 * off-list spelling is not on its own an error. The two real failures are a
 * name ast-grep does not know at all (`C#`), which aborts config parsing so
 * every rule goes unreported, and a valid name for the wrong parser
 * (`TypeScript` over `.tsx`), which reports nothing and reads as a clean
 * codebase. `verify` catches both; see `verify.ts`.
 *
 * Pinned by set-equality against the binary in
 * `test/ast-grep-vendor-contract.test.ts`, so a version bump that adds or drops
 * a language fails there rather than silently narrowing what the router
 * believes is buildable locally.
 */
export const AST_GREP_LANGUAGES = [
  "Bash",
  "C",
  "Cpp",
  "CSharp",
  "Css",
  "Dart",
  "Elixir",
  "Go",
  "Haskell",
  "Hcl",
  "Html",
  "Java",
  "JavaScript",
  "Json",
  "Kotlin",
  "Lua",
  "Markdown",
  "Nix",
  "Php",
  "Python",
  "Ruby",
  "Rust",
  "Scala",
  "Solidity",
  "Swift",
  "Tsx",
  "TypeScript",
  "Yaml",
] as const;

/** One of the spellings {@link AST_GREP_LANGUAGES} lists, canonically cased. */
export type AstGrepLanguage = (typeof AST_GREP_LANGUAGES)[number];

/**
 * The spellings ast-grep also accepts that are not on the canonical list,
 * mapped to the language each resolves to.
 *
 * Keys are lowercase because ast-grep's own matching is case-insensitive:
 * `TYPESCRIPT`, `Cs` and `GOLANG` all resolve at 0.45.2. That makes the whole
 * accepted vocabulary "the canonical list plus these, compared lowercased",
 * which is what {@link resolveAstGrepLanguage} implements.
 *
 * Every value here was probed through a real config, because that is the only
 * thing a rule file is ever fed to. That is deliberate: `sg run --lang` is a
 * SEPARATE vocabulary and cannot stand in for this one. MEASURED at 0.45.2,
 * the two agree on `C++` and `cxx` (both accepted) and on `C#` (both
 * rejected), but `--lang` rejects with clap's own `is not supported!` before
 * a rule is ever read, so it exercises a different code path and is not
 * evidence about `language:`. At 0.41.0 they diverged outright: `--lang C++`
 * was rejected while `language: C++` parsed. Nothing here probes `--lang`.
 *
 * THIS IS THE ONE LIST HERE THE BINARY CANNOT BE ASKED TO ENUMERATE. `sg run
 * -h` prints the canonical list, so `AST_GREP_LANGUAGES` above is checked by
 * set-equality against it; nothing prints the aliases. Each entry is instead
 * pinned by *probing*, in the "language aliases" suite of
 * `test/ast-grep-vendor-contract.test.ts`: every key is fed to the binary in a
 * config and the resolution is read back out of the scan stream's own
 * `language` field — ast-grep reports the canonical name it settled on, so the
 * mapping is the binary's answer rather than ours. The same suite feeds a
 * sweep of near-misses (`h`, `mjs`, `sh`, `tf`, `csx`) and asserts they are
 * rejected, so a bump that ADDS an alias fails there too.
 *
 * Whitespace is not folded, deliberately: `language: "ts "` is rejected by the
 * binary, so accepting it here would pass a rule that cannot run.
 */
export const AST_GREP_LANGUAGE_ALIASES: Readonly<
  Record<string, AstGrepLanguage>
> = {
  "c++": "Cpp",
  cc: "Cpp",
  cs: "CSharp",
  cxx: "Cpp",
  ex: "Elixir",
  golang: "Go",
  hs: "Haskell",
  js: "JavaScript",
  jsx: "JavaScript",
  kt: "Kotlin",
  py: "Python",
  rb: "Ruby",
  rs: "Rust",
  sol: "Solidity",
  ts: "TypeScript",
  yml: "Yaml",
};

/** Every canonical name, keyed by its own lowercase spelling. */
const CANONICAL_BY_LOWERCASE = new Map<string, AstGrepLanguage>(
  AST_GREP_LANGUAGES.map((name) => [name.toLowerCase(), name])
);

/**
 * The language ast-grep would parse `spelling` as, or `undefined` if it would
 * reject the config outright.
 *
 * `undefined` is the fatal case, not a stylistic one: an unrecognized name
 * fails `SgLang` deserialization, which aborts parsing of the single config
 * Taskless assembles for the run — so every *other* sg rule goes unreported
 * with it.
 */
export function resolveAstGrepLanguage(
  spelling: string
): AstGrepLanguage | undefined {
  // NOT trimmed. Measured at 0.45.2, ast-grep rejects `"ts "` — folding the
  // whitespace here would call a rule valid that the binary refuses to load.
  const key = spelling.toLowerCase();
  return CANONICAL_BY_LOWERCASE.get(key) ?? AST_GREP_LANGUAGE_ALIASES[key];
}

/**
 * The `.ts` / `.tsx` split — the one pair of ast-grep languages that share a
 * family and read disjoint file extensions.
 *
 * MEASURED at 0.45.2: a `TypeScript` rule over a `.tsx` tree exits zero having
 * matched nothing, and a `Tsx` rule scans `.tsx` only. That is the quiet
 * failure of the two, because "no findings" is exactly what a clean codebase
 * looks like. Pinned by "treats Tsx and TypeScript as different parsers, not
 * aliases" in `test/ast-grep-vendor-contract.test.ts`.
 *
 * Kept to this pair deliberately. Every other language's extensions would be a
 * second vendored table with no measured backing, and the trap only exists
 * where two languages look like spellings of one thing.
 */
export const AST_GREP_TSX_SPLIT: Readonly<
  Partial<Record<AstGrepLanguage, string>>
> = {
  TypeScript: "ts",
  Tsx: "tsx",
};

/**
 * The Vale release carried by the `@taskless/vale-<platform>` packages pinned
 * in `packages/cli/package.json`. Their npm versions append a build stamp
 * (`3.18.0-20260824195610`); this is the version Vale itself reports.
 *
 * Pinned against the binary by `test/vale-vendor-contract.test.ts`
 * ("engine capabilities" → "reports the pinned version").
 */
export const VALE_VERSION = "3.19.0";

/**
 * Which tier Vale routes an extension to.
 *
 * `converter:<program>` carries the program's own name in the tier, so one
 * table row states both the tier and the thing a user would install. The name
 * is the one Vale prints in its `E100` text, because that is the string a
 * reader will search for.
 */
export type ValeFormatTier =
  /** Parsed in-process: the document is prose, its own syntax is skipped. */
  | "markup"
  /** Parsed in-process: comment text is linted, the code body is invisible. */
  | "comment"
  /** No parser: the whole file is linted as one block of prose. */
  | "plaintext"
  /** Vale shells out to a program the `@taskless/vale-*` packages do not ship. */
  | `converter:${string}`;

/** The `ValeFormatTier` prefix that marks a converter-dependent format. */
const CONVERTER_TIER_PREFIX = "converter:";

/**
 * EVERY MEASURED VALE EXTENSION, AND ITS TIER. THE ONLY TABLE.
 *
 * Adding an extension is one line here; every list, glob, notice and test below
 * derives from this record, so there is no second place to keep in step. Two
 * branches once measured this independently and produced two tables that
 * disagreed about six extensions — that is what this single record exists to
 * make impossible.
 *
 * MEASURED, NOT DOCUMENTED, AND MEASURED BY A DISCRIMINATING PROBE. Ordinary
 * prose fires in all three readable tiers, so it can never separate them. Each
 * tier is pinned by the property only that tier has, in
 * `test/vale-vendor-contract.test.ts`:
 *
 * - **markup** — a construct only a real parser skips yields ZERO (a fenced
 *   code block, an Org `#` line, an HTML comment).
 * - **comment** — the token in a comment yields one finding and the same token
 *   on a bare non-comment line yields ZERO. A type that fires on both is the
 *   plaintext fallback wearing a code extension.
 * - **plaintext** — a bare line yields a finding. Listed only where the tier is
 *   surprising: `.tex`, `.mkd` and `.mkdn` all look like markup and are not.
 *   Everything unnamed lands here too, which is why this tier does not need to
 *   be exhaustive.
 * - **converter** — a non-zero exit whose output carries `E100` and the
 *   program's name.
 *
 * Measured spellings, not families. `.mdown` is native Markdown and `.mkd` and
 * `.mkdn` are not; `.asc` is a third AsciiDoc spelling that crashes exactly
 * like `.adoc`; `.ditamap` is plaintext while `.dita` needs `dita`. Case is
 * part of the key — `.r` and `.R` were both measured, `.PY` was measured and is
 * not comment-aware. Add a row only after probing it; the contract test refuses
 * to take one on faith.
 *
 * A VERSION BUMP INVALIDATES THIS TABLE — RE-MEASURE THE WHOLE OF IT. The tiers
 * are a property of {@link VALE_VERSION}'s binary, and the dangerous direction
 * is a format Vale *learns*: an extension missing from this table is read as
 * plain text today, but the moment Vale routes it to a converter the same
 * omission is a crash that takes down every Vale rule in the run.
 *
 * THE TABLE HELD ACROSS 3.18.0 → 3.19.0, AND THAT IS NOT THE SAME AS THE BUMP
 * BEING FREE. Every row below was re-probed against the 3.19.0 binary and not
 * one of them moved. What moved was a format Vale *learned*, which is precisely
 * the case a table of existing rows cannot report: `.ex` and `.exs` gained
 * comment and doc-attribute extraction, so they left the unnamed plaintext
 * fallback for the `comment` tier and are new rows below.
 *
 * Read that direction carefully, because it is a narrowing rather than a gain.
 * On 3.18.0 an Elixir file was linted as one block of prose, so a rule matching
 * `[*.ex]` fired on identifiers and string literals as readily as on comments.
 * On 3.19.0 the code body is invisible and only comments and `@doc` attributes
 * are read. Findings disappear, no error is raised, and nothing but a re-probe
 * would have told us. A format Vale learns is never a no-op: the benign version
 * of it is this one, and the dangerous version is a converter (see `.typ`).
 *
 * `.mdx` stayed `markup` and changed underneath the tier: a JSX element's
 * children are now read as the Markdown they are, so a Vale rule covers prose
 * inside `<Steps>` or `<Aside>` that it previously skipped, and those children
 * carry the element name as a `text.class.<name>` scope. The tier is the wrong
 * instrument for that kind of change — it says a parser exists, not what the
 * parser sees — which is the second reason a bump needs more than this table.
 *
 * The 3.17.1 → 3.18.0 bump is what the dangerous case looks like in practice.
 * Every row was re-probed against the 3.18.0 binary then too, and eight moved,
 * in three different directions — which is why "re-measure" is not boilerplate:
 *
 * - `.mdx` gained a native parser: `converter:mdx2vast` → `markup`. It is
 *   supported now, and `[*.{md,mdx}]` is a legitimate matcher again.
 * - `.typ` gained a parser that shells out to `typst2vast`
 *   (https://docs.vale.sh/formats/typst): `plaintext` →
 *   `converter:typst2vast`. That is the dangerous direction — 3.17.1 read it as
 *   prose, and the same row on 3.18.0 crashes the run. It stays unsupported
 *   permanently, since we do not support formats needing an external program.
 * - `.rmd` gained a real Markdown parser, so it left the "looks like markup and
 *   is not" list above: `plaintext` → `markup`.
 * - `.qml` and `.scss` gained parsers that see their comments: `plaintext` →
 *   `comment`. Vale's docs had claimed both for years; on 3.17.1 the claim was
 *   measurably false and on 3.18.0 it is true.
 * - `.qmd` (Quarto) and `.myst` (MyST) measured as `markup`, and `.qdoc` as
 *   `comment` — QDoc documentation lives in a doc-comment block, so it is
 *   comment extraction rather than the markup tier a first reading of the
 *   release notes suggests, and probing it with bare prose reads as no support
 *   at all. All three are new rows, none of them reachable on 3.17.1.
 *
 * PHP also changed without the release notes saying so: comment extraction now
 * needs a real `<?php` tag, where 3.17.1 linted a bare `//` comment without
 * one. The tier did not move, but the probe had to. Re-probe every row on the
 * next bump, by the discriminating property and by each language's own comment
 * syntax — a wrong delimiter reads exactly like absent support.
 */
export const VALE_FORMAT_TIERS: Readonly<Record<string, ValeFormatTier>> = {
  // markup — parsed, the format's own constructs skipped
  ".htm": "markup",
  ".html": "markup",
  ".markdown": "markup",
  ".md": "markup",
  ".mdx": "markup",
  ".mdown": "markup",
  ".myst": "markup",
  ".org": "markup",
  ".qmd": "markup",
  ".rmd": "markup",
  ".xhtml": "markup",
  // comment text only — the code body is invisible
  ".c": "comment",
  ".c++": "comment",
  ".bsh": "comment",
  ".cc": "comment",
  ".clj": "comment",
  ".cpp": "comment",
  ".cs": "comment",
  ".css": "comment",
  ".csx": "comment",
  ".cxx": "comment",
  ".ex": "comment",
  ".exs": "comment",
  ".go": "comment",
  ".h": "comment",
  ".h++": "comment",
  ".hpp": "comment",
  ".hs": "comment",
  ".java": "comment",
  ".jl": "comment",
  ".js": "comment",
  ".jsx": "comment",
  ".less": "comment",
  ".lua": "comment",
  ".php": "comment",
  ".pl": "comment",
  ".pm": "comment",
  ".pod": "comment",
  ".proto": "comment",
  ".ps1": "comment",
  ".qdoc": "comment",
  ".qml": "comment",
  ".py": "comment",
  ".py3": "comment",
  ".pyw": "comment",
  ".r": "comment",
  ".R": "comment",
  ".rb": "comment",
  ".rs": "comment",
  ".sass": "comment",
  ".scss": "comment",
  ".sbt": "comment",
  ".scala": "comment",
  ".swift": "comment",
  ".ts": "comment",
  ".tsx": "comment",
  // plaintext, and surprising about it — these look parsed and are not
  ".mkd": "plaintext",
  ".mkdn": "plaintext",
  ".tex": "plaintext",
  // plaintext HERE, though Vale's own docs list it as comment-tier. Measured on
  // the pinned 3.19.0 binary a bare non-comment line lints, which is the
  // plaintext signature. `.qml` and `.scss` sat here for the same reason until
  // 3.18.0 made the docs true for them; `.pyi` is the row where transcribing
  // the docs would still ship the wrong tier — the case for probing rather than
  // copying.
  ".pyi": "plaintext",
  // converter-dependent — Vale supports the format, we ship no converter
  ".adoc": "converter:asciidoctor",
  ".asc": "converter:asciidoctor",
  ".asciidoc": "converter:asciidoctor",
  ".dita": "converter:dita",
  ".typ": "converter:typst2vast",
  ".rest": "converter:rst2html",
  ".rst": "converter:rst2html",
  ".xml": "converter:xsltproc and an XSLT stylesheet",
};

/** Every extension in `tier`, in table order. */
function extensionsInTier(tier: ValeFormatTier): string[] {
  return Object.entries(VALE_FORMAT_TIERS)
    .filter(([, entry]) => entry === tier)
    .map(([extension]) => extension);
}

/**
 * Extensions Vale parses as markup: the whole document is prose, and the
 * format's own non-prose constructs are excluded.
 *
 * The HTML entries carry a consequence worth stating to an author: prose
 * outside an element is not linted, so a bare sentence in a `.html` file yields
 * nothing.
 */
export const VALE_MARKUP_EXTENSIONS: readonly string[] =
  extensionsInTier("markup");

/**
 * Extensions where Vale lints **comment text only** and ignores the code body.
 */
export const VALE_COMMENT_EXTENSIONS: readonly string[] =
  extensionsInTier("comment");

/**
 * Extensions measured into the plaintext fallback whose spelling suggests
 * otherwise.
 *
 * Not exhaustive and not meant to be — every unnamed extension is plaintext
 * too. These are the ones an author would reasonably assume were parsed, so
 * they are worth naming in a recipe rather than leaving to "everything else".
 */
export const VALE_PLAINTEXT_EXTENSIONS: readonly string[] =
  extensionsInTier("plaintext");

/**
 * The converter each converter-dependent extension needs, keyed by extension.
 *
 * The lookup `rules/vale/formats.ts` uses to name a converter in the skip
 * notice. Keys are lowercase because every measured converter format is; a
 * caller comparing an extension off the filesystem must lowercase it first, or
 * `README.RST` becomes a crash on case-insensitive platforms only.
 */
export const VALE_CONVERTER_BY_EXTENSION: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(VALE_FORMAT_TIERS).flatMap(([extension, tier]) =>
      tier.startsWith(CONVERTER_TIER_PREFIX)
        ? [[extension, tier.slice(CONVERTER_TIER_PREFIX.length)]]
        : []
    )
  );

/** A format Vale supports upstream but cannot read without an external tool. */
export interface ValeConverterFormat {
  /** Extensions Vale routes through this converter. */
  extensions: readonly string[];
  /** The executable or artifact Vale looks for, named in its own E100 text. */
  converter: string;
}

/** The converter-dependent extensions grouped by the program they need. */
function groupByConverter(): ValeConverterFormat[] {
  const groups = new Map<string, string[]>();
  for (const [extension, converter] of Object.entries(
    VALE_CONVERTER_BY_EXTENSION
  )) {
    const existing = groups.get(converter);
    if (existing === undefined) groups.set(converter, [extension]);
    else existing.push(extension);
  }
  return [...groups].map(([converter, extensions]) => ({
    converter,
    extensions,
  }));
}

/**
 * Formats that fail rather than lint, because Vale shells out to a converter
 * this CLI does not ship.
 *
 * SAY THIS ACCURATELY: Vale supports these formats. What is missing is the
 * external program it delegates the parse to. The failure is environmental, and
 * describing it as "Vale does not support reStructuredText" sends an author
 * looking for the wrong fix.
 *
 * The blast radius is what makes this worth surfacing at routing time rather
 * than at authoring time: Vale exits 2 with an `E100` runtime error and
 * abandons the run, and `--no-exit` does not suppress it. One `.typ` file
 * caught by a rule's glob takes down the entire Vale pass, including every
 * other rule and every other file — so `[*.{md,typ}]` is not a slightly wider
 * matcher than `[*.md]`, it is a broken one. (`[*.{md,mdx}]` was that example
 * until 3.18.0 gave MDX a native parser — the membership of this tier is a
 * property of {@link VALE_VERSION}, and so is the worked example.)
 */
export const VALE_CONVERTER_DEPENDENT: readonly ValeConverterFormat[] =
  groupByConverter();

/**
 * Vale's checker tag per converter-dependent extension, from the `E100` text.
 *
 * This is the host-independent half of the failure. The prose after the tag is
 * not: `.xml` reports `xsltproc not found` where the program is absent and
 * `no XSLT transform provided` where it is present, and the two are split by
 * platform — macOS ships `/usr/bin/xsltproc`, the Linux CI image does not. A
 * contract test that matched on the program name therefore passed locally and
 * failed in CI, which is how this list came to exist.
 *
 * `.xml` is also the one entry whose converter is not sufficient on its own. An
 * XSLT transform is document-specific, so there is no default to ship and
 * installing `xsltproc` does not make `.xml` lintable — unlike `asciidoctor`,
 * which genuinely fixes `.adoc`. That is why its `converter` names the
 * stylesheet as well as the program.
 */
export const VALE_CONVERTER_CHECKERS: Readonly<Record<string, string>> = {
  ".rst": "lintRST",
  ".rest": "lintRST",
  ".adoc": "lintAdoc",
  ".asciidoc": "lintAdoc",
  ".asc": "lintAdoc",
  ".xml": "lintXML",
  ".dita": "lintDITA",
  ".typ": "lintTypst",
};

/** Every converter-dependent extension, flattened. */
export const VALE_CONVERTER_DEPENDENT_EXTENSIONS: readonly string[] =
  Object.keys(VALE_CONVERTER_BY_EXTENSION);

/** `Bash, C, Cpp, …` — the ast-grep language list as recipe prose. */
export function astGrepLanguageList(): string {
  return AST_GREP_LANGUAGES.join(", ");
}

/** `.htm, .html, …` — Vale's markup extensions as recipe prose. */
export function valeMarkupList(): string {
  return VALE_MARKUP_EXTENSIONS.join(", ");
}

/** `.c, .c++, …` — Vale's comment-only extensions as recipe prose. */
export function valeCommentList(): string {
  return VALE_COMMENT_EXTENSIONS.join(", ");
}

/**
 * `.mkd, .mkdn, …` — the plaintext extensions worth naming, as recipe prose.
 *
 * Rendered rather than written into the recipe because the surprising cases are
 * exactly the ones a hand-written list gets wrong.
 */
export function valePlaintextList(): string {
  return VALE_PLAINTEXT_EXTENSIONS.join(", ");
}

/**
 * `.rst (needs rst2html), …` — Vale's converter-dependent formats as recipe
 * prose, each naming the tool whose absence is the actual failure.
 */
export function valeConverterList(): string {
  return VALE_CONVERTER_DEPENDENT.map(
    ({ extensions, converter }) =>
      `${extensions.join("/")} (needs ${converter})`
  ).join(", ");
}
