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
 * unchanged, and `verify` does not check it, so a plausible-looking `C++` or
 * `yaml` reaches the binary and fails there.
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
export const VALE_VERSION = "3.17.1";

/**
 * Extensions Vale parses as markup: the whole document is prose, and the
 * format's own non-prose constructs are excluded.
 *
 * MEASURED, NOT DOCUMENTED. Each entry was distinguished from the plaintext
 * fallback by a construct only a real parser skips — a fenced code block for
 * Markdown, a `#` line for Org, an HTML comment for the HTML family — because
 * on ordinary prose a markup parse and a plaintext parse are indistinguishable.
 *
 * The HTML entries carry a consequence worth stating to an author: prose
 * outside an element is not linted, so a bare sentence in a `.html` file yields
 * nothing.
 */
export const VALE_MARKUP_EXTENSIONS = [
  ".htm",
  ".html",
  ".markdown",
  ".md",
  ".org",
  ".xhtml",
] as const;

/**
 * Extensions where Vale lints **comment text only** and ignores the code body.
 *
 * MEASURED BY THE NEGATIVE, which is the only test that separates this tier
 * from the plaintext fallback: a token inside a comment yields a finding, and
 * the same token on a bare non-comment line yields nothing. A file type that
 * fires on both is plaintext, not comment-aware.
 *
 * Case-sensitive, and not closed over the obvious aliases. `.r` and `.R` are
 * both here because both were measured; `.PY` was measured and is not
 * comment-aware, and neither are `.hh`/`.hxx` despite `.h`/`.hpp` being. Add an
 * entry only after probing it — the contract test below refuses to take one on
 * faith.
 */
export const VALE_COMMENT_EXTENSIONS = [
  ".c",
  ".c++",
  ".cc",
  ".clj",
  ".cpp",
  ".cs",
  ".css",
  ".cxx",
  ".go",
  ".h",
  ".h++",
  ".hpp",
  ".hs",
  ".java",
  ".jl",
  ".js",
  ".jsx",
  ".less",
  ".lua",
  ".php",
  ".pl",
  ".pm",
  ".proto",
  ".ps1",
  ".py",
  ".pyw",
  ".r",
  ".R",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".swift",
  ".ts",
  ".tsx",
] as const;

/** A format Vale supports upstream but cannot read without an external tool. */
export interface ValeConverterFormat {
  /** Extensions Vale routes through this converter. */
  extensions: readonly string[];
  /** The executable or artifact Vale looks for, named in its own E100 text. */
  converter: string;
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
 *
 * VERSION-SENSITIVE. Vale 3.18.0 parses MDX natively, so a bump past it moves
 * `.mdx` out of this list; that is a {@link VALE_VERSION} edit plus an entry
 * removal here, and the contract test fails until both happen.
 */
export const VALE_CONVERTER_DEPENDENT: readonly ValeConverterFormat[] = [
  { extensions: [".rst"], converter: "rst2html" },
  { extensions: [".adoc", ".asciidoc"], converter: "asciidoctor" },
  { extensions: [".xml"], converter: "an XSLT transform" },
  { extensions: [".dita"], converter: "dita" },
  { extensions: [".mdx"], converter: "mdx2vast" },
];

/** Every converter-dependent extension, flattened. */
export const VALE_CONVERTER_DEPENDENT_EXTENSIONS: readonly string[] =
  VALE_CONVERTER_DEPENDENT.flatMap((format) => format.extensions);

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
 * `.rst (needs rst2html), …` — Vale's converter-dependent formats as recipe
 * prose, each naming the tool whose absence is the actual failure.
 */
export function valeConverterList(): string {
  return VALE_CONVERTER_DEPENDENT.map(
    ({ extensions, converter }) =>
      `${extensions.join("/")} (needs ${converter})`
  ).join(", ");
}
