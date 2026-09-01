import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  gitIgnoredExclusionGlobs,
  isGitIgnoredPath,
  listGitIgnoredEntries,
} from "../src/rules/git-ignored";
import { findValeBinary } from "../src/rules/vale/binary";
import { migrateFixture } from "./support/current-project";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");
const fixturesDirectory = resolve(
  import.meta.dirname,
  "fixtures/mixed-engines-project"
);

/**
 * A whole-project `check` must not report findings from paths git ignores.
 *
 * The reported case (taskless/cli#166) was a git worktree at
 * `worktrees/<name>/`, which is a complete second checkout: every rule fires
 * again over another branch's files, so the finding count moves when a worktree
 * appears or disappears and nothing in the output says why. The general shape is
 * the same for `dist/`, vendored trees, and local scratch directories.
 *
 * The two engines arrive at the same behavior by different routes and both are
 * pinned here, deliberately. ast-grep honors `.gitignore` through its own
 * walker and always did — the assertion exists so that an edit to `sgWalkArgv`
 * (adding `--no-ignore vcs`, say) cannot take it away silently. Vale honors
 * nothing and is handed git's answer as `--glob` exclusions. A test that only
 * covered the engine that was broken would let the two drift apart again, which
 * is the condition that made the bug hard to attribute in the first place.
 *
 * These spawn the built CLI over a real git repository. Neither half can be
 * usefully faked: the question is what ast-grep's walker and Vale's walker
 * actually do, and a mock would be asserting the mock.
 */

/** Run the built CLI, tolerating a non-zero exit. */
async function runCli(
  arguments_: string[]
): Promise<{ stdout: string; exitCode: number }> {
  await migrateFixture(arguments_);

  try {
    const { stdout } = await execFileAsync("node", [binPath, ...arguments_]);
    return { stdout, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout: string; code: number };
    return { stdout: failure.stdout ?? "", exitCode: failure.code };
  }
}

interface CheckFinding {
  source: string;
  ruleId: string;
  file: string;
}

interface CheckOutput {
  results: CheckFinding[];
}

async function checkedFiles(
  project: string,
  arguments_: string[] = []
): Promise<CheckFinding[]> {
  const { stdout } = await runCli([
    "check",
    "-d",
    project,
    "--json",
    ...arguments_,
  ]);
  return (JSON.parse(stdout.trim()) as CheckOutput).results;
}

/** Findings whose file sits under `ignored/`, by engine. */
function sourcesUnderIgnored(results: CheckFinding[]): Set<string> {
  return new Set(
    results
      .filter((finding) => finding.file.startsWith("ignored/"))
      .map((finding) => finding.source)
  );
}

/** Vale ships per-platform; an unsupported host has none. */
const valeAvailable = findValeBinary().path !== undefined;

describe("check over a project with a gitignored directory", () => {
  let project: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "taskless-gitignore-"));
    await cp(fixturesDirectory, project, { recursive: true });
    // A duplicate of the fixture's two rule-tripping files, one directory
    // deeper. This is the worktree case in miniature: the same documents, in a
    // place git has been told not to track.
    await mkdir(join(project, "ignored"), { recursive: true });
    await cp(join(project, "README.md"), join(project, "ignored/README.md"));
    await cp(join(project, "sample.js"), join(project, "ignored/sample.js"));
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  describe("in a git repository that ignores it", () => {
    beforeEach(async () => {
      await writeFile(join(project, ".gitignore"), "ignored/\n");
      await execFileAsync("git", ["init", "--quiet"], { cwd: project });
    });

    it("reports nothing from the ignored directory on a bare walk", async () => {
      const results = await checkedFiles(project);

      expect(sourcesUnderIgnored(results)).toEqual(new Set());
      // Not vacuous: the same rules must still fire on the tracked copies, or
      // this would pass just as happily with the engines switched off.
      const trackedSources = new Set(results.map((finding) => finding.source));
      expect(trackedSources).toContain("ast-grep");
      if (valeAvailable) expect(trackedSources).toContain("vale");
    });

    it("checks the ignored directory when it is named explicitly", async () => {
      // An explicitly named path is an instruction, not an accident. The ignore
      // rule belongs to the walk we chose, not to the one the user asked for.
      const results = await checkedFiles(project, ["ignored"]);

      const expected = new Set(
        valeAvailable ? ["ast-grep", "vale"] : ["ast-grep"]
      );
      expect(sourcesUnderIgnored(results)).toEqual(expected);
    });
  });

  describe("outside a git repository", () => {
    it("falls back to the existing walk and checks everything", async () => {
      // No `git init`, so nothing is ignored and nothing may be skipped. This
      // is the failure mode the fix must not have: a `git` that errors out
      // silently pruning the project down to nothing.
      const results = await checkedFiles(project);

      const expected = new Set(
        valeAvailable ? ["ast-grep", "vale"] : ["ast-grep"]
      );
      expect(sourcesUnderIgnored(results)).toEqual(expected);
    });
  });
});

describe("listGitIgnoredEntries", () => {
  let project: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "taskless-lsfiles-"));
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it("collapses a wholly-ignored directory to one entry", async () => {
    await writeFile(join(project, ".gitignore"), "ignored/\nnoise.log\n");
    await mkdir(join(project, "ignored/deep"), { recursive: true });
    await writeFile(join(project, "ignored/deep/a.md"), "a\n");
    await writeFile(join(project, "ignored/deep/b.md"), "b\n");
    await writeFile(join(project, "noise.log"), "noise\n");
    await execFileAsync("git", ["init", "--quiet"], { cwd: project });

    const entries = await listGitIgnoredEntries(project);

    // The reason this is the complement of `--cached --others` and not the set
    // itself: the directory is one entry however many files it holds.
    expect(entries).toContain("ignored/");
    expect(entries).toContain("noise.log");
    expect(entries).not.toContain("ignored/deep/a.md");
  });

  it("ignores nothing when the walk root is itself ignored", async () => {
    // Standing inside a gitignored directory is as explicit as naming it. git
    // answers `./` there — "everything here" — and honouring that would return
    // an empty check with nothing saying why.
    await writeFile(join(project, ".gitignore"), "build/\n");
    await mkdir(join(project, "build"), { recursive: true });
    await writeFile(join(project, "build/a.md"), "a\n");
    await execFileAsync("git", ["init", "--quiet"], { cwd: project });

    expect(await listGitIgnoredEntries(join(project, "build"))).toEqual([]);
  });

  it("returns nothing outside a git repository", async () => {
    await writeFile(join(project, "noise.log"), "noise\n");

    expect(await listGitIgnoredEntries(project)).toEqual([]);
  });
});

describe("gitIgnoredExclusionGlobs", () => {
  it("turns a directory entry into a subtree pattern and leaves files alone", () => {
    expect(gitIgnoredExclusionGlobs(["worktrees/", "agents.lock"])).toEqual([
      "worktrees/**",
      "agents.lock",
    ]);
  });

  it("drops entries that would not survive the glob alternation", () => {
    // A comma would split into two patterns inside `!{…}` and both halves
    // would be wrong; the rest would stop being literal paths.
    expect(
      gitIgnoredExclusionGlobs(["a,b.md", "star*.md", "brace{x}.md", "fine.md"])
    ).toEqual(["fine.md"]);
  });
});

describe("isGitIgnoredPath", () => {
  const entries = ["worktrees/", "a,b.md"];

  it("matches a file under an ignored directory", () => {
    expect(isGitIgnoredPath("worktrees/probe/README.md", entries)).toBe(true);
  });

  it("matches an ignored file the glob had to drop", () => {
    // The skip notice has no alternation to survive, so a path excluded from
    // the glob is still known to be ignored here.
    expect(isGitIgnoredPath("a,b.md", entries)).toBe(true);
  });

  it("does not match a tracked path that merely shares a prefix", () => {
    expect(isGitIgnoredPath("worktrees-notes.md", entries)).toBe(false);
  });
});
