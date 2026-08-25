import { execFile } from "node:child_process";

/**
 * What git considers ignored, and how the engines are told to skip it.
 *
 * ## Why this exists
 *
 * A whole-project `check` reported findings from paths git ignores — build
 * output, vendored trees, and (the case that surfaced it, taskless/cli#166) a
 * git worktree at `worktrees/<name>/`, which is a complete second checkout. A
 * worktree is the worst shape of the bug because it duplicates *every* finding
 * and attributes each copy to a branch the user is not working on, so the
 * finding count moves when a worktree appears or disappears with nothing in the
 * output explaining why.
 *
 * ## The two engines do not need the same amount of help
 *
 * **ast-grep already honors `.gitignore` and always has.** Its walker is the
 * `ignore` crate, and `sgWalkArgv` passes `--no-ignore hidden` *only* —
 * deliberately not `vcs`, which is the value that would switch VCS ignore files
 * off. Measured against the pinned 0.41.0 in a repository ignoring
 * `worktrees/`: a bare scan reports nothing under `worktrees/probe/`, and it
 * reports nothing under a hidden-*and*-ignored `packages/cli/.turbo/` either,
 * which is the case that would expose `--no-ignore hidden` if that flag had
 * quietly disabled more than hidden-file skipping. So nothing in `scan.ts`
 * changes; `check-gitignore.test.ts` pins the behavior so a future flag edit
 * cannot take it away silently.
 *
 * **Vale honors nothing.** It has no notion of a VCS, walks `.` as handed to
 * it, and reads hidden directories by default — so every gitignored document in
 * the tree was linted. That is the whole of taskless/cli#166, and this module
 * is what closes it.
 *
 * ## Why `git ls-files` and not a `.gitignore` parser
 *
 * The styleguide's rule about not adding a dependency to answer a question the
 * existing toolchain can answer applies squarely. `.gitignore` is not one file
 * and not one syntax question: the real answer folds in nested `.gitignore`s at
 * every level, `.git/info/exclude`, the user's global `core.excludesFile`, and
 * negation patterns that re-include a path a parent excluded. A parsing library
 * approximates that; git *is* it, it is already required for `check`'s other
 * work (see `util/git-remote.ts`), and it answers in one call.
 *
 * The call is `--others --ignored --exclude-standard --directory`, which is the
 * *complement* of the set the issue proposed (`--cached --others
 * --exclude-standard`). Both describe the same partition; the complement is
 * chosen because it is the one that scales. The positive set is every file in
 * the project — thousands of paths that would have to reach Vale as positional
 * arguments and would meet `ARG_MAX` on a large repository. The complement is
 * short, because `--directory` collapses an entirely-ignored directory to a
 * single entry: `node_modules/` is one line, not forty thousand, and this
 * repository yields thirty entries in total.
 */

/**
 * Paths git ignores under `cwd`, relative to it, directories with a trailing
 * `/`.
 *
 * `-z` rather than newline-delimited output: a filename may legally contain a
 * newline, and without `-z` git renders such a path quoted and C-escaped, so a
 * line-split would produce two entries neither of which names a real file.
 *
 * Every failure mode returns an empty list, and that is the required behavior
 * rather than a swallowed error: a directory that is not a git repository has
 * nothing ignored, and it is the same answer a host with no `git` on its PATH
 * must get. The engines then walk exactly as they did before this module
 * existed, which is the non-git fallback the issue asks for.
 */
export async function listGitIgnoredEntries(cwd: string): Promise<string[]> {
  const stdout = await new Promise<string>((resolve) => {
    execFile(
      "git",
      [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
        "-z",
      ],
      { cwd, maxBuffer: 16 * 1024 * 1024 },
      (error, output) => {
        resolve(error ? "" : output);
      }
    );
  });

  const entries = [
    ...new Set(stdout.split("\0").filter((entry) => entry !== "")),
  ];

  // A walk root that is itself ignored answers `./`, and that single entry
  // means "everything here". Measured by running `check` from inside a
  // gitignored `build/`: git reports `./` and nothing else. Excluding it would
  // hand the user an empty result set for a directory they deliberately stood
  // in, with nothing in the output explaining where their findings went — the
  // same silent-count-change complaint the issue opened with, inverted.
  //
  // Standing in a directory is as explicit as naming it, so the answer is the
  // one an explicit path gets: ignore nothing. This does not currently change
  // behavior — Vale's glob does not match `README.md` against `./**` — but that
  // is a property of Vale's matcher, not a decision anyone made, and the whole
  // failure mode is invisible. Decided here instead.
  return entries.some((entry) => ROOT_ENTRIES.has(entry)) ? [] : entries;
}

/** How git can spell "the walk root itself" in a `--directory` listing. */
const ROOT_ENTRIES = new Set(["./", "."]);

/**
 * Characters that would make an entry mean something other than itself once it
 * is spliced into Vale's `--glob` alternation.
 *
 * A comma is the dangerous one: `buildValeGlob` joins patterns with `,` inside
 * `!{…}`, so a filename containing a comma would split into two patterns, and
 * both halves would be wrong. The rest are glob metacharacters that would turn
 * a literal path into a matcher.
 *
 * An entry carrying any of them is left out of the exclusion rather than
 * escaped. Vale's glob dialect is not ours to guess at, and the cost of leaving
 * it out is that one pathologically-named ignored path is still linted — which
 * is exactly the behavior that shipped before this module, so it is a gap
 * rather than a regression. {@link isGitIgnoredPath} does not share the
 * restriction, so such a path is still kept out of the skip notice.
 */
const GLOB_METACHARACTERS = /[*?[\]{},\\!]/;

/**
 * The ignored entries, rendered as patterns for Vale's `--glob`.
 *
 * A directory entry becomes `dir/**` rather than `dir/`, because Vale matches
 * the pattern against files and never against the directory itself. A file
 * entry is used verbatim: git already reports it as a path relative to the
 * project root, and every pattern in the combined alternation is matched
 * path-wise (see `buildValeGlob` in `formats.ts` for why that is a property of
 * the whole expression rather than of one branch).
 */
export function gitIgnoredExclusionGlobs(entries: string[]): string[] {
  return entries
    .filter((entry) => !GLOB_METACHARACTERS.test(entry))
    .map((entry) => (entry.endsWith("/") ? `${entry}**` : entry));
}

/**
 * Whether `path` — relative to the project root — falls inside `entries`.
 *
 * Plain string work, deliberately: the entries are literal paths from git, so
 * answering this with a glob engine would reintroduce the metacharacter
 * problem {@link gitIgnoredExclusionGlobs} has to duck. This is what keeps the
 * converter skip notice from naming files Vale was never going to open.
 */
export function isGitIgnoredPath(path: string, entries: string[]): boolean {
  return entries.some((entry) =>
    entry.endsWith("/") ? path.startsWith(entry) : path === entry
  );
}
