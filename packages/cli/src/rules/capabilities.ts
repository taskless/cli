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
 *   string with no enum, and `verify` never validates a rule's `language`, so
 *   any spelling passes our own checks and fails only inside ast-grep.
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
export const AST_GREP_VERSION = "0.41.0";

/**
 * Every language ast-grep can parse, verbatim from
 * `sg run -h` → `Supported languages are: [...]` at
 * {@link AST_GREP_VERSION}.
 *
 * SPELLINGS ARE ast-grep's, NOT ours and not `detect`'s. `Cpp`, `CSharp`,
 * `JavaScript`, `Tsx` — a rule's `language:` field is handed to ast-grep
 * unchanged and `verify` does not check it, so the binary is the first thing
 * with an opinion. MEASURED at 0.41.0: it accepts some off-list aliases
 * (`C++` and `cpp` both resolve to Cpp), so an off-list spelling is not
 * reliably an error. The two real failures are a name ast-grep does not know
 * at all (`C#`), which aborts config parsing so every rule goes unreported,
 * and a valid name for the wrong parser (`TypeScript` over `.tsx`), which
 * reports nothing and reads as a clean codebase. Neither is caught locally.
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

/**
 * The Vale release carried by the `@taskless/vale-<platform>` packages pinned
 * in `packages/cli/package.json`. Their npm versions append a build stamp
 * (`3.17.1-20260810052605`); this is the version Vale itself reports.
 *
 * Pinned against the binary by `test/vale-vendor-contract.test.ts`
 * ("engine capabilities" → "reports the pinned version").
 */
export const VALE_VERSION = "3.18.0";

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
 *   surprising: `.tex`, `.rmd`, `.mkd` and `.mkdn` all look like markup and are
 *   not. Everything unnamed lands here too, which is why this tier does not
 *   need to be exhaustive.
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
 * Vale 3.18.0 is the known incoming bump, and it moves rows in three different
 * directions — which is why "re-measure" is not boilerplate here:
 *
 * - `.mdx` gains a native parser, so it moves `converter:mdx2vast` → `markup`
 *   and becomes supported.
 * - `.typ` gains a parser that shells out to `typst2vast`
 *   (https://docs.vale.sh/formats/typst), so it moves `plaintext` →
 *   `converter:typst2vast`. That is the dangerous direction: today it is read
 *   as prose, and after the bump the same row would crash the run. It also
 *   stays unsupported permanently, since we do not support formats needing an
 *   external program.
 * - MyST, Quarto and QDoc arrive with parsers needing no external program, so
 *   they become genuinely supportable and want `markup` rows once measured.
 *
 * All four are documented as requiring v3.18.0 or later, so none of them is
 * reachable from {@link VALE_VERSION}. Re-probe every row on the bump.
 */
export const VALE_FORMAT_TIERS: Readonly<Record<string, ValeFormatTier>> = {
  // markup — parsed, the format's own constructs skipped
  ".htm": "markup",
  ".html": "markup",
  ".markdown": "markup",
  ".md": "markup",
  ".mdx": "markup",
  ".mdown": "markup",
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
  // plaintext HERE, though Vale's own docs list them as comment-tier. The docs
  // describe the CURRENT Vale; we pin 3.17.1. Measured on the pinned binary a
  // bare non-comment line lints, which is the plaintext signature. Transcribing
  // the docs would have shipped these as comment-tier and been wrong for this
  // build — the case for probing rather than copying.
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
 * abandons the run, and `--no-exit` does not suppress it. One `.mdx` file
 * caught by a rule's glob takes down the entire Vale pass, including every
 * other rule and every other file — so `[*.{md,mdx}]` is not a slightly wider
 * matcher than `[*.md]`, it is a broken one.
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
