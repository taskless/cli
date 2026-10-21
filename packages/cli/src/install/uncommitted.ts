import { execFile } from "node:child_process";

import { CANONICAL_DIR, type InstallPlan } from "./install";
import { renderNoticeBox } from "./notice-box";
import { permissionFiles } from "./permissions";

/**
 * The notice an install owes an agent that works in worktrees.
 *
 * A worktree is built from COMMITS. `init` writes `.taskless/`, the skill
 * directories, and the harness permission files into the working tree and
 * commits nothing, so an agent that opens a fresh worktree straight after
 * `init` (Claude Code does this on every session for some people) gets a
 * checkout with no Taskless in it at all. Nothing errors: the skill is simply
 * absent, and nothing in the worktree says why.
 *
 * The fix is one commit in the main checkout. The wizard offers to make it,
 * since it knows exactly what it wrote; the batch install, which nobody is
 * there to answer, says the commit is owed before the onboarding line sends
 * the person to their agent.
 */

/**
 * Every path an install owns, relative to `cwd`: the canonical store, each
 * reference target's skill directories, and every permission file the
 * manifest records a Taskless rule in.
 *
 * Read from the manifest rather than from this run's edits, because a re-run
 * that found everything already written edits nothing, and those files are
 * just as uncommitted as they were the first time.
 */
export async function installedPaths(
  cwd: string,
  plan: InstallPlan
): Promise<string[]> {
  const paths = new Set<string>([CANONICAL_DIR]);
  for (const target of plan.targets) {
    for (const skill of target.skills) {
      paths.add(`${target.dir}/skills/${skill.name}`);
    }
  }
  for (const file of await permissionFiles(cwd)) paths.add(file);
  return [...paths];
}

/**
 * The paths under `pathspecs` that a commit would not carry: untracked,
 * modified, or staged but not yet committed. Ignored files are left out, since
 * a commit would not carry those either and that is the project's choice.
 *
 * Empty outside a git repository, and when git cannot be run at all: neither
 * has a worktree to miss anything.
 *
 * An untracked directory is reported once, as the directory, rather than file
 * by file, so a fresh install lists `.taskless/` and not its every file.
 */
export async function findUncommitted(
  cwd: string,
  pathspecs: readonly string[]
): Promise<string[]> {
  // `git status` reports paths from the repository root, whatever `cwd` is,
  // so the prefix is stripped to list them as the person typed `init`. Every
  // pathspec sits under `cwd`, so every result carries the prefix.
  const shown = await git(cwd, ["rev-parse", "--show-prefix"]);
  const prefix = shown?.trim();
  if (prefix === undefined) return [];
  const status = await git(cwd, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=normal",
    "--",
    ...pathspecs,
  ]);
  if (status === undefined) return [];

  const paths: string[] = [];
  const entries = status.split("\0");
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry === undefined || entry.length < 4) continue;
    // A rename or copy carries its source as the next entry, which is not a
    // path in this tree any more.
    if (entry[0] === "R" || entry[0] === "C") index++;
    const path = entry.slice(3);
    paths.push(path.startsWith(prefix) ? path.slice(prefix.length) : path);
  }
  return paths.toSorted();
}

/** The message the wizard offers when it commits an install for the user. */
export const DEFAULT_COMMIT_MESSAGE =
  "chore: Installs Taskless and sets up coding agent support";

/**
 * The batch install's banner, or `undefined` when everything it wrote is
 * committed.
 *
 * Deliberately not a file list. The person needs to know that a commit is
 * owed and why; `git status` already says what goes in it.
 */
export function getUncommittedNotice(
  paths: readonly string[]
): string | undefined {
  if (paths.length === 0) return undefined;
  return renderNoticeBox("COMMIT BEFORE YOU START YOUR AGENT", [
    "The files Taskless just installed are not committed yet. Commit them " +
      "before you start your agent: agents that work in worktrees won't " +
      "see uncommitted files.",
  ]);
}

/** Every uncommitted path this install owns, as a banner. */
export async function getUncommittedInstallNotice(
  cwd: string,
  plan: InstallPlan
): Promise<string | undefined> {
  return getUncommittedNotice(
    await findUncommitted(cwd, await installedPaths(cwd, plan))
  );
}

/**
 * Commit exactly `paths`, and nothing else the person had staged.
 *
 * `git commit -- <paths>` records only those paths, so an unrelated change
 * already in the index stays staged and out of this commit. The person's own
 * hooks and signing configuration run as they would for any commit; a hook
 * that refuses, or a merge in progress, comes back as git's own words.
 */
export async function commitInstall(
  cwd: string,
  paths: readonly string[],
  message: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const added = await run(cwd, ["add", "--", ...paths]);
  if (!added.ok) return added;
  return run(cwd, ["commit", "--quiet", "-m", message, "--", ...paths]);
}

function git(cwd: string, args: string[]): Promise<string | undefined> {
  return run(cwd, args).then((result) =>
    result.ok ? result.stdout : undefined
  );
}

function run(
  cwd: string,
  args: string[]
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      resolve(
        error
          ? { ok: false, error: (stderr || error.message).trim() }
          : { ok: true, stdout }
      );
    });
  });
}
