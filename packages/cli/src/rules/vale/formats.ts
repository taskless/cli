import { glob, stat } from "node:fs/promises";
import { basename, extname, resolve as resolvePath } from "node:path";

import {
  VALE_CONVERTER_BY_EXTENSION,
  VALE_CONVERTER_DEPENDENT_EXTENSIONS,
} from "../capabilities";
import { GLOB_METACHARACTERS } from "../git-ignored";

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
 *
 * **Every entry here must already be safe to splice into `!{…}` verbatim.**
 * This function does not escape or validate — every caller is responsible for
 * that before the pattern reaches here, because a real glob (`.taskless/**`,
 * `**\/*.adoc`) and a literal discovered path (an oversized file's own name)
 * need opposite treatment: a glob's metacharacters are meant, a literal path's
 * are not. See {@link escapeGlobLiteral} for the literal-path side, and
 * `gitIgnoredExclusionGlobs` in `git-ignored.ts` for the sibling case that
 * drops a dangerous entry instead of escaping it.
 */
export function buildValeGlob(patterns: string[]): string | undefined {
  if (patterns.length === 0) return undefined;
  return `--glob=!{${patterns.join(",")}}`;
}

/**
 * Escape a literal path so it means only itself once spliced into
 * {@link buildValeGlob}'s `!{…}` alternation.
 *
 * `gitIgnoredExclusionGlobs` (`git-ignored.ts`) faces the identical problem —
 * a discovered path with a comma or a glob metacharacter meaning something
 * other than itself in the alternation — and answers it by dropping the entry
 * instead of escaping it. This function makes the opposite call, and the
 * difference is not a style preference: dropping a git-ignored entry only
 * costs the exclusion of a path Vale would otherwise walk past anyway (noisy
 * findings inside a vendored tree, nothing more), while dropping an oversized
 * file from ITS exclusion means the pathologically large file that triggered
 * the guard is the one file left unprotected — undoing the entire point of
 * `findOversizedFiles`. A false-positive skip is the wrong failure mode for
 * the same reason a false-positive notice was in the sibling case: the risk
 * this guard exists to prevent is concentrated in exactly the files this
 * would refuse to escape.
 *
 * Verified against the real binary, not assumed: `--glob=!{big\,comma.md}`
 * excludes a file literally named `big,comma.md`, while the unescaped form
 * (`!{big,comma.md}`) does not — it splits into two patterns, `big` and
 * `comma.md`, neither of which matches the real file. A backslash is Vale's
 * own escape character in this position, the same dialect
 * `GLOB_METACHARACTERS` was already written against.
 */
export function escapeGlobLiteral(path: string): string {
  return path.replaceAll(new RegExp(GLOB_METACHARACTERS, "g"), String.raw`\$&`);
}

/** How many skipped paths a notice names before it summarizes the rest. */
const NOTICE_SAMPLE_LIMIT = 5;

/**
 * Render a bounded, comma-joined list for a notice: every label up to
 * {@link NOTICE_SAMPLE_LIMIT}, then `(and N more)` for the rest.
 *
 * Shared by {@link skippedFilesNotice} and {@link oversizedFilesNotice},
 * which otherwise had the identical four lines twice — same limit, same
 * truncation shape, same reason (a notice naming hundreds of files is not
 * more readable than one naming five and a count). Unlike the two
 * declined-to-merge cases elsewhere in this module, this is genuinely one
 * piece of formatting knowledge, so a caller mapping its own items to labels
 * first (`oversizedFilesNotice` maps `OversizedFile` to `.file`) is the only
 * difference between the two call sites.
 */
function summarizeList(labels: string[]): string {
  const sample = labels.slice(0, NOTICE_SAMPLE_LIMIT);
  const remainder = labels.length - sample.length;
  return remainder > 0
    ? `${sample.join(", ")} (and ${String(remainder)} more)`
    : sample.join(", ");
}

/** Directories never worth walking to build a notice. */
const UNWALKED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  TASKLESS_DIRECTORY,
]);

/** `glob`'s `exclude` predicate for {@link UNWALKED_DIRECTORIES}. */
function isUnwalkedEntry(entry: string | Buffer): boolean {
  return UNWALKED_DIRECTORIES.has(basename(String(entry)));
}

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
 * One file above `maxBytes`, found while walking the run's targets.
 *
 * Carries the measured size alongside the path so the caller can report an
 * exact number rather than just naming the file — see `oversizedFileResult`
 * in `run.ts`, which is the only reader.
 */
export interface OversizedFile {
  file: string;
  size: number;
}

/**
 * Files inside the run's target set whose size exceeds `maxBytes` —
 * `VALE_MAX_FILE_BYTES` in `run.ts` (not imported here to avoid a cycle;
 * `run.ts` already imports this module).
 *
 * Same shape as {@link findConverterDependentFiles}, and the same reasoning:
 * Vale is not merely slow on an oversized file, it is quadratic in that one
 * file's size (see the docblock on `VALE_MAX_FILE_BYTES`), so one file over the
 * limit can consume the whole run's timeout budget and take every other file's
 * findings down with it. Preemptively excluding it — rather than letting Vale
 * discover the cost the hard way — is the same trade `converterExclusionGlobs`
 * makes for a format Vale cannot parse at all.
 *
 * `sectionGlobs`, when given, is `AssembledValeConfig.sections` from
 * `assembleValeConfig` — the exact section patterns Vale's own rules are
 * scoped to. The scan globs those patterns instead of every file in the
 * tree, exactly as {@link findConverterDependentFiles} globs by its extension
 * list, and for the same reason precision matters here: a bare `**\/*` walk
 * finds every file under the target roots regardless of whether any rule
 * would ever touch it, and reporting one of those as "not checked" is a false
 * positive, not a caught coverage hole. Measured against this repository:
 * `pnpm-lock.yaml` and `packages/cli/CHANGELOG.md` are both over the limit,
 * and neither is named by any `[section]` in any rule's `.vale.ini` — no
 * rule was ever going to open either one, so the un-scoped walk reported
 * lost coverage that never existed.
 *
 * The patterns are read from `assembleValeConfig`'s own return value, never
 * by re-parsing the `.vale.ini` it wrote — see the doc on
 * `sectionPatternsOf` in `assemble.ts` for why that distinction matters.
 *
 * `sectionGlobs === undefined` falls back to the previous exhaustive `**\/*`
 * walk under each target root. That path exists for a caller with no
 * assembled config to ask — `verifyValeRule`'s isolating config, or a test
 * that hands `runVale` a hand-written `.vale.ini` directly — and is
 * unaffected by everything below: same cost, same behavior as before this
 * parameter existed.
 *
 * A named path is stat'd directly when there is no `sectionGlobs` to consult
 * (the fallback below), exactly as `targetFileParseError` does elsewhere in
 * this package: an explicit request is not resolved through the walk that
 * answers a whole-project run. **That changes once `sectionGlobs` is given.**
 * An explicitly named file is not exempt from scoping either — measured
 * against the real binary, Vale spends 9ms and reports nothing on a 128KB+
 * file whose extension no section names, the same as a file it never opened
 * at all, because no rule is ever assigned to run against it. Checking it
 * unconditionally would reintroduce the exact false positive this parameter
 * exists to remove, just reachable via `check some-file.yaml` instead of a
 * whole-project run. So when sections are known, a named file is a candidate
 * only if it is also a match for one of them — the same membership test the
 * walk below already computes.
 *
 * Whether named or discovered by the walk, an oversized file is excluded
 * unconditionally once it qualifies, on every run — the same asymmetry
 * `findConverterDependentFiles` documents, and for the same reason: handing
 * Vale this file does not check it badly, it risks the entire batch's
 * timeout.
 *
 * Errors are swallowed the same way as {@link findConverterDependentFiles} and
 * for the same reason: a target that vanished between listing and stat, an
 * unreadable subtree, a platform where `glob` rejects the pattern — none of
 * them can be allowed to suppress the exclusion that already ran. The failure
 * mode here is "no notice, never no fix".
 *
 * **Known dialect gap, not introduced here: Node's `glob` does not descend
 * into dot-directories, Vale's own walker does.** Measured against this
 * repository with a rule forced to match `**\/README.md` everywhere: the real
 * binary visits 22 files, including `.taskless/rules/vale/*\/.tests/*\/README.md`
 * and other paths under a leading dot; this module's `glob()` call finds only
 * the 10 that sit outside every dot-directory. For {@link
 * findConverterDependentFiles} that gap is one-directional and safe — it
 * costs the *notice* accuracy, never the exclusion, because that exclusion
 * rides on a static extension pattern handed to Vale's own `--glob`, which
 * traverses dot-directories fine. Here it is not fully safe: the discovered
 * path IS the exclusion, so an oversized file living inside a dot-directory
 * this scan cannot see is not excluded, and Vale may still spend its
 * quadratic cost linting it if some section reaches that directory. This
 * repository has no live exposure — the one dot-directory any section here
 * names, `.taskless/`, is separately and unconditionally excluded before
 * Vale ever runs — but a project with section-matched content under another
 * dot-directory (`.github/`, a dotfile-heavy docs tree) would not be
 * protected by this scan for a file that lives there. Left as a documented
 * gap rather than fixed here: closing it means replacing `glob()` with a
 * custom walker that treats dot-directories differently from
 * `UNWALKED_DIRECTORIES`, which is a larger change than this pass, and
 * `VALE_TIMEOUT_MS` remains the backstop if it is ever hit.
 */
export async function findOversizedFiles(
  cwd: string,
  paths: string[],
  maxBytes: number,
  wholeProject: boolean,
  sectionGlobs?: string[]
): Promise<OversizedFile[]> {
  const roots = wholeProject ? ["."] : paths;
  const found = new Map<string, OversizedFile>();

  const checkCandidate = async (relative: string): Promise<void> => {
    if (found.has(relative)) return;
    try {
      const stats = await stat(resolvePath(cwd, relative));
      if (stats.isFile() && stats.size > maxBytes) {
        found.set(relative, { file: relative, size: stats.size });
      }
    } catch {
      // Gone between listing and stat, or unreadable. Not a reason to drop
      // the exclusion already computed.
    }
  };

  if (sectionGlobs === undefined) {
    // No assembled config to ask what Vale would actually lint — fall back to
    // the previous behavior: every named path is a candidate regardless of
    // scope, and every root is walked exhaustively.
    for (const path of paths) await checkCandidate(path);
    for (const root of roots) {
      const prefix = root === "." || root === "" ? "" : `${root}/`;
      try {
        for await (const match of glob(`${prefix}**/*`, {
          cwd,
          exclude: isUnwalkedEntry,
        })) {
          await checkCandidate(String(match));
        }
      } catch {
        // A target that is not a directory, an unreadable subtree, a
        // platform where `glob` rejects the pattern: all of them mean "no
        // notice, never no fix". The exclusion has already been applied by
        // the time this runs.
      }
    }
  } else {
    // Section patterns are root-relative, exactly as Vale reads them — never
    // prefixed per target root, the way the extension-based fallback above
    // is. A whole-project run needs no further narrowing: every match is
    // already in scope. An explicit target (`check src/` or `check
    // src/doc.md`) narrows the matches down to that subtree afterward
    // instead, because a section like `CLAUDE.md` or `**/README.md` has no
    // meaningful "under src/" form to prefix onto — Vale itself evaluates
    // every section against the whole project and only its own target list
    // decides what it actually visits, so intersecting after the glob
    // mirrors that rather than guessing at one. This is also what makes a
    // named file's in-scope test free: it needs no separate membership
    // check, because a pattern like `**/README.md` already matches a
    // top-level `README.md` found this way, whether or not the caller named
    // it explicitly.
    //
    // `wholeProject` is a PARAMETER, not `paths.length === 0` computed here —
    // that test is wrong for `check .`. `filterExistingPaths` (`commands/
    // check.ts`) normalizes a bare `.` into `paths = ["."]`, length 1, so a
    // length test reads it as an explicit target, `roots` becomes `["."]`,
    // and every match (`README.md`) fails `relative === "." ||
    // relative.startsWith("./")` — every candidate silently dropped, and the
    // whole guard goes dark on a near-default invocation. `isWholeProjectWalk`
    // (`walk-scope.ts`) exists precisely for this and is what callers must
    // resolve `paths` through before reaching here; `runVale` already
    // computes it for its own `targets`/`.taskless/**` exclusion and passes
    // the same value in, rather than this function recomputing a second,
    // broken answer.
    for (const pattern of sectionGlobs) {
      try {
        for await (const match of glob(pattern, {
          cwd,
          exclude: isUnwalkedEntry,
        })) {
          const relative = String(match);
          if (
            !wholeProject &&
            !roots.some(
              (root) => relative === root || relative.startsWith(`${root}/`)
            )
          ) {
            continue;
          }
          await checkCandidate(relative);
        }
      } catch {
        // Same reasoning as the fallback walk: a malformed pattern or an
        // unreadable subtree means "no notice, never no fix".
      }
    }
  }

  // One sorted return for both branches — declined to unify further with
  // `findConverterDependentFiles`'s `[...found].toSorted()` (taskless/cli#323
  // review): that one sorts a `Set<string>` with the default string
  // comparator, this one sorts a `Map`'s values by a field via
  // `localeCompare`. The resemblance is that both produce a stable,
  // alphabetical order for a notice — not a shared invariant the two could
  // drift apart on — so a shared helper would exist only to hide two
  // different container types behind one name.
  return [...found.values()].toSorted((a, b) => a.file.localeCompare(b.file));
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

  const listed = summarizeList(files);

  return (
    `Vale did not check ${String(files.length)} file(s): ${listed}. These ` +
    `formats are not supported by this build — Vale parses them only through ` +
    `an external program (${converters.join(", ")}), which this build does ` +
    `not ship and does not check for. Scope the rule to a supported format; ` +
    `every other file was checked normally.`
  );
}

/**
 * The user-facing sentence for a set of files excluded for being over
 * `maxBytes` (`VALE_MAX_FILE_BYTES` in `run.ts`), or `undefined` when nothing
 * was excluded.
 *
 * A NOTICE, not a finding — deliberately the opposite of what #300
 * (`vale-parse-error` in `run.ts`) chose for an unparseable file, and for a
 * reason that only shows up once a finding is actually tried here. #300's
 * finding is trustworthy because Vale itself proved the file was a real
 * target: it opened the file, tried to parse it, and told us exactly why it
 * failed. {@link findOversizedFiles} proves nothing of the kind — it is a bare
 * filesystem walk that runs before Vale is ever invoked, with no way to know
 * whether any configured rule's matcher would have reached the file at all.
 *
 * That is not a hypothetical gap. Reporting this exclusion as a hard
 * `severity: "error"` finding, and running a whole-project `check` against
 * *this* repository, reported `pnpm-lock.yaml` (152,820 bytes) and
 * `packages/cli/CHANGELOG.md` (139,171 bytes) as failures — and neither file
 * is named by any `[section]` in any rule's `.vale.ini` under
 * `.taskless/rules/vale/`. Vale was
 * never going to open either one, so a finding there is not a caught coverage
 * hole, it is a false one. Confirming true scope would mean re-implementing
 * Vale's own glob-matching against the assembled config from outside Vale —
 * exactly the second parser the "Verify Build Output In The Build, Not By
 * Parsing It" reasoning in `STYLEGUIDE-CODE.md` warns against: Vale already
 * knows which files its rules reach, nothing in this module does, and
 * approximating that knowledge is worse than not claiming it.
 *
 * A converter-dependent file ({@link skippedFilesNotice}, just above) is in
 * the same epistemic position — that walk is equally blind to rule scope —
 * which is why it already reports a notice rather than a finding. This
 * exclusion follows that precedent rather than #300's.
 *
 * None of this changes whether the file is excluded from the Vale invocation:
 * it still is, unconditionally, in every case (see `oversizedInScope` in
 * `run.ts`). That protects against the real risk — a rule DOES turn out to
 * match the file, and Vale's quadratic cost on it consumes the run's
 * timeout — at zero cost on the files above, which no rule was ever going to
 * reach. Only the *reporting* softens to match what we actually know; the
 * exclusion does not.
 */
export function oversizedFilesNotice(
  files: OversizedFile[],
  maxBytes: number
): string | undefined {
  if (files.length === 0) return undefined;

  const listed = summarizeList(files.map((entry) => entry.file));

  return (
    `Vale did not check ${String(files.length)} file(s) over ${String(maxBytes)} ` +
    `bytes: ${listed}. Vale's cost grows quadratically with a single file's ` +
    `size, so a file this large risks consuming the whole run's timeout budget ` +
    `and costing every other file its findings — it was excluded rather than ` +
    `risk that. Split large files into smaller documents to have them checked.`
  );
}
