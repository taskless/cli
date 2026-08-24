import { glob } from "node:fs/promises";
import { basename, extname } from "node:path";

import {
  VALE_CONVERTER_BY_EXTENSION,
  VALE_CONVERTER_DEPENDENT_EXTENSIONS,
} from "../capabilities";

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
 * ## The table lives in `rules/capabilities.ts`
 *
 * `VALE_FORMAT_TIERS` there is the single measured record of what Vale does
 * with an extension, and everything in this module is derived from it — the
 * exclusion list, the glob, and the converter named in the notice. Nothing here
 * restates a tier, because a second copy is precisely how two independently
 * measured tables came to disagree about six extensions.
 *
 * `capabilities.ts` is the home rather than this file because the same tiers
 * are read by two consumers with incompatible constraints: this module, which
 * runs Vale, and `src/prompts/recipes.ts`, which renders the tiers into the
 * agent recipes and must stay free of every host capability (`node:fs` here
 * would fail `assert-prompts-graph` at build time). Pure data satisfies both.
 *
 * ## Asserting known support rather than dodging known breakage
 *
 * The tiers are **measured against the pinned binary**, not read off Vale's
 * documentation, and `vale-vendor-contract.test.ts` re-measures every entry
 * against the real binary on every run, each tier by the property only that
 * tier has. A format whose tier changes — or a converter Vale starts requiring
 * for a format we currently call native — turns that test red before it can
 * turn a user's check silently green.
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
 * converter to be missing.
 *
 * **That property is pinned to the vendored binary, and a version bump is what
 * breaks it.** "Unknown to us" is safe only while it also means "unknown to
 * Vale": the moment Vale learns a format, it starts routing that extension to a
 * parser, and if that parser shells out, an extension missing from the table is
 * a crash rather than a plain-text read. Vale 3.18.0 is the live example — it
 * adds Typst, which parses through `typst2vast`, so `.typ` stops being the
 * plaintext read it is today and upgrading the `@taskless/vale-*` packages
 * without re-measuring would reintroduce exactly this bug under a new
 * extension. Re-measure the whole table on every bump; the per-extension cases
 * in `vale-vendor-contract.test.ts` are how.
 *
 * Note what the exclusion policy buys here. Because a format needing an
 * external program is never supported, a newly-converter-backed extension has
 * one correct destination rather than a judgement call, and the answer does not
 * depend on what happens to be installed on the machine running `check`.
 */

/**
 * Extensions Vale must never be handed, lowercase, leading dot, sorted.
 *
 * Derived from the tier table rather than written out again, so adding a
 * measured entry there is the whole change.
 */
export const CONVERTER_DEPENDENT_EXTENSIONS: readonly string[] = [
  ...VALE_CONVERTER_DEPENDENT_EXTENSIONS,
].toSorted();

/**
 * The converter Vale would need for `path`, or `undefined` if it needs none.
 *
 * Extension comparison is **case-sensitive, because Vale's own routing is**.
 * Measured against the pinned binary: `docs/guide.adoc` exits 2 with
 * `E100 [lintAdoc]`, while `docs/guide.ADOC` and `docs/guide.AdOc` are read as
 * plain text and exit 0 with findings — including when the uppercase spelling
 * names a lowercase file on a case-insensitive filesystem, since Vale routes on
 * the path string it was handed, not on the name the disk holds.
 *
 * This used to lowercase, on the assumption that a case-insensitive filesystem
 * would make `README.RST` reStructuredText to Vale. It does not, and the
 * assumption cost accuracy in the one place this function is read: a file Vale
 * had linted perfectly well was named in the skip notice as one it never
 * checked. Matching Vale exactly is what keeps the notice true, and it is the
 * same discipline as the tier table — measure the binary, do not reason about
 * it. `vale-vendor-contract.test.ts` pins the measurement, so a Vale that
 * becomes case-insensitive turns red here before it can crash a user's run.
 */
export function converterFor(path: string): string | undefined {
  return VALE_CONVERTER_BY_EXTENSION[extname(path)];
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
 *
 * Every match is re-checked through `converterFor` before it is kept, and that
 * is not belt-and-braces. Node's `glob` inherits the filesystem's own case
 * folding, so on macOS `**\/*.{adoc,…}` matches `docs/GUIDE.ADOC` — a file Vale
 * routes to its plain-text reader and lints normally. Left unfiltered, the
 * notice would claim a checked file was skipped, and it would claim it on
 * exactly one platform. `converterFor` is the one place that knows how Vale
 * routes, so the walk defers to it rather than trusting the pattern.
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
        if (converterFor(match) !== undefined) found.add(match);
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
 * Phrased as "not supported by this build", not "Vale does not support": Vale
 * supports every one of these formats, and telling a user otherwise sends them
 * to the wrong project's issue tracker.
 *
 * It names the converter as an *explanation*, never as an instruction. A format
 * that needs an external program is not supported here, full stop — so the
 * sentence must not read as "install `asciidoctor` and this will work", because
 * the exclusion is unconditional and does not consult the host. The action
 * offered is the one that actually works: scope the rule to a supported format.
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
    `Vale did not check ${String(files.length)} file(s): ${listed}. These ` +
    `formats are not supported by this build — Vale parses them only through ` +
    `an external program (${converters.join(", ")}), which this build does ` +
    `not ship and does not check for. Scope the rule to a supported format; ` +
    `every other file was checked normally.`
  );
}
