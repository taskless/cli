#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * Maintain the rolling pull request for a vendored toolchain bump.
 *
 * Both detect workflows — Vale's and ast-grep's — arrive here with the same
 * shape: a working tree that already carries the proposed bump, a title, and a
 * body. What happens next is identical for both, so it lives in one place
 * rather than as two copies of the same shell that drift.
 *
 * ONE STATIC BRANCH PER ENGINE, `vendor/<engine>`. The alternative, a branch
 * per upstream version, means a second release while the first is unreviewed
 * opens a SECOND pull request proposing a conflicting edit to the same lines,
 * and someone has to notice and close the stale one. A rolling branch instead
 * carries whatever upstream's current answer is: the proposal is rewritten, the
 * title and body are rewritten with it, and there is exactly one thing to
 * review. It also means a reviewer who comes back after a week is not looking
 * at a bump that upstream has already superseded.
 *
 * THE BRANCH IS REBUILT FROM `main`, NOT APPENDED TO (`checkout -B`). The
 * proposal is "main plus this bump", and it has to stay that as `main` moves.
 * Appending would accumulate one commit per upstream release and slowly turn
 * the diff into a history of versions nobody pinned.
 *
 * WHICH IS WHY FORCE-PUSHING NEEDS TWO GUARDS, because rebuilding a branch
 * somebody may be reviewing is the obvious way this hurts someone:
 *
 *   - Nothing is pushed when the rebuilt branch matches what is already on the
 *     remote. A scheduled run that finds the same upstream version must be
 *     inert, or every run rewrites the branch, and every rewrite dismisses
 *     approvals and re-triggers CI on an unchanged proposal.
 *
 *   - Nothing is pushed when the remote branch carries a commit this workflow
 *     did not write. A reviewer who pushes a fixup onto the branch has done the
 *     most reasonable thing available to them, and a force-push would silently
 *     delete it. The run warns and stops instead, which costs a stale proposal
 *     until someone looks — strictly better than costing someone's work.
 *
 * Usage:
 *   node .github/scripts/vendor-pr.cjs \
 *     --branch vendor/vale \
 *     --title "chore(vale): pin Vale 3.21.0" \
 *     --body-file /path/to/body.md \
 *     --message "chore(vale): pin Vale 3.21.0" \
 *     [--label skip-changeset] \
 *     -- packages/cli/package.json pnpm-lock.yaml
 *
 * Everything after `--` is the set of paths to stage. They are passed to git as
 * an argv array, never through a shell, so a path is a path even if it contains
 * something a shell would find interesting.
 */

const { execFileSync } = require("node:child_process");

/** Commits with this author are ours to overwrite. Anything else is not. */
const BOT_AUTHOR = "github-actions[bot]";

const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  const flags = separator === -1 ? argv : argv.slice(0, separator);
  const paths = separator === -1 ? [] : argv.slice(separator + 1);

  const read = (name) => {
    const at = flags.indexOf(name);
    if (at === -1) {
      return undefined;
    }
    const value = flags[at + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} needs a value`);
    }
    return value;
  };

  const options = {
    branch: read("--branch"),
    title: read("--title"),
    bodyFile: read("--body-file"),
    message: read("--message"),
    label: read("--label"),
    paths,
  };

  for (const required of ["branch", "title", "bodyFile", "message"]) {
    if (!options[required]) {
      throw new Error(
        `--${required.replace(/[A-Z]/g, "-$&").toLowerCase()} is required`
      );
    }
  }
  if (paths.length === 0) {
    throw new Error("no paths to stage were given after `--`");
  }
  return options;
}

/**
 * Whether anyone but this workflow wrote what is on the branch.
 *
 * Takes author lines rather than running git itself, because this is the
 * decision worth testing and it is a decision about a list of strings. An empty
 * list — no branch yet — is not foreign.
 */
function hasForeignCommits(authorLines) {
  return authorLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .some((author) => author !== BOT_AUTHOR);
}

const runner =
  (command) =>
  (args, { allowFailure = false } = {}) => {
    try {
      return execFileSync(command, args, { encoding: "utf8" }).trim();
    } catch (error) {
      if (allowFailure) {
        return undefined;
      }
      const detail = error.stderr?.toString().trim() ?? error.message;
      throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
    }
  };

async function main({
  argv = process.argv.slice(2),
  git = runner("git"),
  gh = runner("gh"),
  log = (line) => console.log(line),
} = {}) {
  const { branch, title, bodyFile, message, label, paths } = parseArgs(argv);

  git(["config", "user.name", BOT_AUTHOR]);
  git(["config", "user.email", BOT_EMAIL]);

  // -B rather than -b: the branch is rebuilt from wherever HEAD is (the freshly
  // checked-out `main`), so the proposal is always "main plus this bump".
  git(["checkout", "-B", branch]);
  git(["add", "--", ...paths]);

  // `diff --cached --quiet` exits non-zero when something IS staged, so a
  // successful run here means the working tree carried no bump after all.
  const nothingStaged =
    git(["diff", "--cached", "--quiet"], { allowFailure: true }) !== undefined;
  if (nothingStaged) {
    log("Nothing staged; there is no bump to propose.");
    return { action: "none", reason: "nothing-staged" };
  }
  git(["commit", "-m", message]);

  const remoteExists =
    git(["ls-remote", "--exit-code", "--heads", "origin", branch], {
      allowFailure: true,
    }) !== undefined;

  // The SHA the guards below are reasoning about, kept so the push can lease
  // against it. See the push itself for why that matters.
  let fetchedTip;

  if (remoteExists) {
    git(["fetch", "--quiet", "origin", branch]);
    fetchedTip = git(["rev-parse", "FETCH_HEAD"]);

    // The TIP author, not every commit since `main`. Asking "which commits are
    // on the branch and not on main" needs a merge base, and `actions/checkout`
    // clones at depth 1, so there is none — the question would answer wrongly
    // or not at all depending on clone depth, which is the worst property a
    // safety guard can have. The tip is sufficient here because this script is
    // the only thing that ever writes the branch, and it does so by force-push:
    // there is no path by which a bot commit lands ON TOP of a human's.
    const tipAuthor = git(["log", "-1", "--format=%an", "FETCH_HEAD"]) ?? "";
    if (hasForeignCommits([tipAuthor])) {
      log(
        `::warning::${branch} was last written by ${tipAuthor}, not this workflow; refusing to force-push over that.`
      );
      return { action: "none", reason: "foreign-commits" };
    }

    // By content, and only the content this run proposes.
    //
    // Comparing SHAs would always say "changed", because the rebuild reparents
    // onto whatever `main` is now. Comparing whole TREES is subtler and was
    // wrong in the same direction: an unrelated commit on `main` makes the
    // trees differ, so an upstream that had not moved still force-pushed the
    // branch and rewrote the pull request — dismissing approvals and
    // restarting CI over somebody else's commit to a different file.
    //
    // The question that matters is "does the branch already propose exactly
    // this bump", so the diff is scoped to the paths being proposed. Falling
    // behind `main` is a real thing that happens to this branch, but it is
    // branch protection's business and one click to resolve, not a reason to
    // rewrite a proposal nobody changed.
    const identical =
      git(["diff", "--quiet", "FETCH_HEAD", "HEAD", "--", ...paths], {
        allowFailure: true,
      }) !== undefined;
    if (identical) {
      log(`${branch} already proposes exactly this; leaving it alone.`);
      return { action: "none", reason: "unchanged" };
    }
  }

  // --force-with-lease, not --force, and the distinction is the whole point of
  // the guards above.
  //
  // Reading the tip author and then force-pushing is a check and an action with
  // a gap between them. A reviewer who pushes a fixup inside that gap has their
  // commit destroyed silently — precisely the outcome the ownership guard
  // exists to prevent, arrived at through timing rather than through logic. A
  // guard that a race defeats is not a guard.
  //
  // The lease closes it by making the push itself assert what the guards
  // assumed: the branch is still the commit we inspected. If it is not, the
  // push is REJECTED and the run fails loudly, which is a report rather than a
  // loss. The SHA is explicit rather than implied by a remote-tracking ref,
  // which also sidesteps the `stale info` failure a shallow clone produces
  // (see the shallow-clone note in CLAUDE.md) — `actions/checkout` clones at
  // depth 1, so there may be no tracking ref to lease against.
  //
  // A branch that does not exist yet has nothing to lease and nothing to
  // overwrite, so it takes an ordinary push. Forcing there would be asserting
  // a claim about a ref that is not there.
  git(
    remoteExists
      ? ["push", `--force-with-lease=${branch}:${fetchedTip}`, "origin", branch]
      : ["push", "origin", branch]
  );

  const existing = gh([
    "pr",
    "list",
    "--head",
    branch,
    "--state",
    "open",
    "--json",
    "number",
    "--jq",
    ".[].number",
  ]);

  if (existing) {
    // `gh pr edit` goes through GraphQL, which this repository has had broken
    // out from under it by the Projects (classic) deprecation. REST does not
    // depend on it. `-F body=@file` reads the file rather than passing its
    // contents as an argument, so third-party release notes never become argv.
    gh([
      "api",
      "-X",
      "PATCH",
      `repos/{owner}/{repo}/pulls/${existing}`,
      "-f",
      `title=${title}`,
      "-F",
      `body=@${bodyFile}`,
    ]);
    log(`Updated #${existing}: ${title}`);
    return { action: "updated", pr: Number(existing) };
  }

  gh([
    "pr",
    "create",
    "--base",
    "main",
    "--head",
    branch,
    "--title",
    title,
    "--body-file",
    bodyFile,
    ...(label ? ["--label", label] : []),
  ]);
  log(`Opened a pull request on ${branch}: ${title}`);
  return { action: "created" };
}

module.exports = { BOT_AUTHOR, hasForeignCommits, main, parseArgs };

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nvendor-pr failed: ${error.message}`);
    process.exitCode = 1;
  });
}
