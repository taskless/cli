import { glob } from "node:fs/promises";
import { basename, extname } from "node:path";

/**
 * Taskless's own directory, as a project-relative path.
 *
 * Lives here rather than in `run.ts` because both the exclusion glob and the
 * notice walk have to agree on what "ours, not the user's prose" means, and two
 * copies of that string is how they stop agreeing.
 */
export const TASKLESS_DIRECTORY = ".taskless";

/**
 * Which markup formats this build of Vale can actually parse.
 *
 * Vale supports AsciiDoc, reStructuredText, XML/DITA and (before 3.18) MDX
 * upstream — but not on its own. For those formats it shells out to an external
 * program to convert the source into something it can lint, and the
 * `@taskless/vale-*` platform packages ship the Vale binary as pure payload
 * with none of those programs alongside it. On a host without the converter the
 * conversion fails, and Vale does not degrade: it prints one
 * `E100 [lintAdoc] Runtime error` object on stderr, writes **nothing** to
 * stdout, and exits 2. The abort is Vale's, not ours, and it is not scoped to
 * the offending file — every finding from every other file in the same run is
 * lost inside Vale before it is ever serialized.
 *
 * So a single `.adoc` anywhere a rule's matcher reaches turned the whole Vale
 * engine off. `check` reported the crash, but as a raw JSON blob among the
 * findings, and the exit code looked the same as any other failing check — so
 * in a repo that already had an ast-grep finding, "every Vale rule stopped
 * running" was indistinguishable from a normal red check.
 *
 * ## Asserting known support rather than dodging known breakage
 *
 * The tiers below are **measured against the pinned binary**, not read off
 * Vale's documentation, and `vale-formats.test.ts` re-measures every entry
 * against the real binary on every run. A format whose tier changes — or a
 * converter Vale starts requiring for a format we currently call native — turns
 * that test red before it can turn a user's check silently green.
 *
 * The reason the operative list is the *converter* tier rather than the native
 * one deserves stating, because "allowlist what we know works" reads like it
 * should be the other way round. Vale does not lint markup only. Anything it
 * does not recognize as markup it reads as plain text or as source-code
 * comments — `.py`, `.ts`, `.yml`, `.txt`, and files with no extension at all
 * (`README`, `LICENSE`, `Makefile`) all get linted, and none of them can shell
 * out. An allowlist expressed as "only hand Vale these extensions" would
 * therefore have to enumerate every language Vale knows *and* would still drop
 * every extensionless file — trading a loud crash for exactly the silent
 * disabling this whole module exists to prevent, over a far larger set of
 * files.
 *
 * The safe path and the unknown path are the same path here, which is what
 * makes an exclusion honest rather than a denylist with a nice name: shelling
 * out is a property of a short, closed set of markup formats, and an extension
 * outside that set falls through to Vale's plain-text reader, which has no
 * converter to be missing. `MARKUP_FORMAT_TIERS` is the assertion — it names
 * what we measured and what we concluded — and the exclusion is derived from
 * it, so the two cannot drift.
 *
 * **That property is pinned to the vendored binary, and a version bump is what
 * breaks it.** "Unknown to us" is safe only while it also means "unknown to
 * Vale": the moment Vale learns a format, it starts routing that extension to a
 * parser, and if that parser shells out, an extension missing from this table is
 * a crash rather than a plain-text read. Vale 3.18.0 is the live example — it
 * added Typst, which converts through `typst2vast`, so upgrading the
 * `@taskless/vale-*` packages without re-measuring would reintroduce exactly
 * this bug under a new extension. Re-measure the table on every bump; the
 * per-extension cases in `vale-formats.test.ts` are how.
 *
 * TODO(capabilities): `packages/cli/src/rules/capabilities.ts` is being built
 * in parallel to hold pinned engine-capability constants, Vale format tiers
 * among them. This table is the single place those tiers live today; move it
 * there wholesale at integration rather than copying entries out of it.
 */
export type ValeFormatTier =
  /** Vale parses it in-process. Safe to hand over. */
  | "native"
  /** Vale shells out to a program we do not ship. Must not be handed over. */
  | "external-converter";

/** One markup extension, the tier we measured it in, and why. */
export interface ValeFormatSupport {
  tier: ValeFormatTier;
  /**
   * The program Vale invokes, for `external-converter` entries. Named in the
   * user-facing notice so "skipped" comes with something to act on.
   */
  converter?: string;
}

/**
 * Every markup extension Vale routes to a syntax-aware parser, tiered.
 *
 * Measured against `@taskless/vale-*` 3.17.1 by linting a one-line file per
 * extension under a `[*]` matcher and recording whether Vale returned findings
 * or aborted with `E100`.
 *
 * `.asc` is the entry worth pointing at: it is a third AsciiDoc spelling, it
 * crashes exactly like `.adoc`, and it was not in the bug report. It is here
 * because the tiers were measured rather than transcribed.
 */
export const MARKUP_FORMAT_TIERS: Readonly<Record<string, ValeFormatSupport>> =
  {
    ".md": { tier: "native" },
    ".markdown": { tier: "native" },
    ".mdown": { tier: "native" },
    ".mkdn": { tier: "native" },
    ".mkd": { tier: "native" },
    ".html": { tier: "native" },
    ".htm": { tier: "native" },
    ".xhtml": { tier: "native" },
    ".org": { tier: "native" },
    ".tex": { tier: "native" },
    ".rmd": { tier: "native" },
    ".adoc": { tier: "external-converter", converter: "asciidoctor" },
    ".asciidoc": { tier: "external-converter", converter: "asciidoctor" },
    ".asc": { tier: "external-converter", converter: "asciidoctor" },
    ".rst": { tier: "external-converter", converter: "rst2html" },
    ".rest": { tier: "external-converter", converter: "rst2html" },
    ".xml": { tier: "external-converter", converter: "an XSLT stylesheet" },
    ".dita": { tier: "external-converter", converter: "dita" },
    ".mdx": { tier: "external-converter", converter: "mdx2vast" },
  };

/**
 * Extensions Vale must never be handed, lowercase, leading dot, sorted.
 *
 * Derived from the tier table rather than written out again, so adding a
 * measured entry there is the whole change.
 */
export const CONVERTER_DEPENDENT_EXTENSIONS: readonly string[] = Object.entries(
  MARKUP_FORMAT_TIERS
)
  .filter(([, support]) => support.tier === "external-converter")
  .map(([extension]) => extension)
  .toSorted();

/**
 * The converter Vale would need for `path`, or `undefined` if it needs none.
 *
 * Extension comparison is lowercased: `README.RST` is a reStructuredText file
 * to Vale on a case-insensitive filesystem, and letting case decide would make
 * the crash reappear on exactly one platform.
 */
export function converterFor(path: string): string | undefined {
  return MARKUP_FORMAT_TIERS[extname(path).toLowerCase()]?.converter;
}

/**
 * Glob patterns, in Vale's dialect, that exclude the converter-dependent files.
 *
 * A globstar-prefixed `*.adoc` rather than a bare one, and this is not
 * cosmetic. Vale matches a `--glob` against the file's **basename** when the
 * pattern contains no `/`, and against its path when it does. Every pattern
 * here is combined into one
 * alternation with `.taskless/**`, which contains a `/` — so the whole
 * expression is matched path-wise, and a bare `*.adoc` branch then stops
 * matching `docs/guide.adoc`. Measured: that exact combination still crashed on
 * a nested file while excluding the root-level one, which is the worst possible
 * shape of bug — it looks fixed in the repository you tested it in.
 */
export function converterExclusionGlobs(): string[] {
  return CONVERTER_DEPENDENT_EXTENSIONS.map((extension) => `**/*${extension}`);
}

/**
 * The single `--glob` expression for a run, or `undefined` when there is
 * nothing to exclude.
 *
 * One expression because Vale accepts one `--glob` and the last one wins:
 * passing two flags silently drops the first, so the exclusions have to be one
 * negated alternation or they are not exclusions at all.
 */
export function buildValeGlob(patterns: string[]): string | undefined {
  if (patterns.length === 0) return undefined;
  return `--glob=!{${patterns.join(",")}}`;
}

/** How many skipped paths a notice names before it summarizes the rest. */
const NOTICE_SAMPLE_LIMIT = 5;

/** Directories never worth walking to build a notice. */
const UNWALKED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  TASKLESS_DIRECTORY,
]);

/**
 * Converter-dependent files inside the run's target set.
 *
 * This exists only so the skip can be *named*. The fix itself needs no file
 * list — Vale's own walker does the excluding — but a fix whose entire user
 * experience is "some findings are quietly not there" would be the bug again
 * one layer down, so the notice has to say which files and which converter.
 *
 * Two things it deliberately does not do. It does not reconstruct Vale's walk:
 * it asks a much narrower question (are there files with these eight
 * extensions?) whose answer is a notice, never a finding, so being approximate
 * costs a slightly vague message and nothing else. And it does not run when
 * there is nothing to say — the common repository has no AsciiDoc at all, and
 * `glob` over a pruned tree returning empty is the whole cost in that case.
 *
 * Known imprecision, and it is one-directional: Node's `glob` does not descend
 * into dot-directories, so a `.github/adr/0001.adoc` is skipped by Vale and
 * goes unnamed here. That under-reports a notice; it never suppresses a
 * finding, and it never lets the crash back in.
 */
export async function findConverterDependentFiles(
  cwd: string,
  paths: string[]
): Promise<string[]> {
  const extensions = CONVERTER_DEPENDENT_EXTENSIONS.map((extension) =>
    extension.slice(1)
  ).join(",");

  // An explicitly named file answers by its own name; only a directory needs
  // walking. A whole-project run has one target, the project.
  const named: string[] = [];
  const roots: string[] = [];
  if (paths.length === 0) {
    roots.push(".");
  } else {
    for (const path of paths) {
      if (converterFor(path) !== undefined) named.push(path);
      roots.push(path);
    }
  }

  const found = new Set(named);
  for (const root of roots) {
    const prefix = root === "." || root === "" ? "" : `${root}/`;
    try {
      for await (const match of glob(`${prefix}**/*.{${extensions}}`, {
        cwd,
        exclude: (entry) => UNWALKED_DIRECTORIES.has(basename(String(entry))),
      })) {
        found.add(match);
      }
    } catch {
      // A target that is not a directory, an unreadable subtree, a platform
      // where `glob` rejects the pattern: all of them mean "no notice", never
      // "no fix". The exclusion has already been applied by the time this runs.
    }
  }

  return [...found].toSorted();
}

/**
 * The user-facing sentence for a set of skipped files, or `undefined` when
 * nothing was skipped.
 *
 * Phrased as "this build cannot parse", not "Vale does not support": Vale
 * supports every one of these formats, and telling a user otherwise sends them
 * to the wrong project's issue tracker. It names the converter because that is
 * the one thing they can act on — installing `asciidoctor` puts the files back
 * in scope with no change on our side.
 */
export function skippedFilesNotice(files: string[]): string | undefined {
  if (files.length === 0) return undefined;

  const converters = [
    ...new Set(
      files.flatMap((file) => {
        const converter = converterFor(file);
        return converter === undefined ? [] : [converter];
      })
    ),
  ].toSorted();

  const sample = files.slice(0, NOTICE_SAMPLE_LIMIT);
  const remainder = files.length - sample.length;
  const listed =
    remainder > 0
      ? `${sample.join(", ")} (and ${String(remainder)} more)`
      : sample.join(", ");

  return (
    `Vale did not check ${String(files.length)} file(s): ${listed}. Vale ` +
    `supports these formats, but parsing them needs an external converter ` +
    `(${converters.join(", ")}) that this build does not ship. Install it and ` +
    `put it on your PATH to have these files checked; every other file was ` +
    `checked normally.`
  );
}
