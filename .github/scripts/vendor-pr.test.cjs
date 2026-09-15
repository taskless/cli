// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for vendor-pr.cjs.
 *
 * The argument parsing and the force-push guard are pure and tested directly.
 * Everything else is tested by driving main() with `git` and `gh` replaced by
 * recorders, which is the only way to reach the ORDER of operations — and the
 * order is where the damage lives. Pushing before checking who owns the branch,
 * or creating a second pull request instead of updating the open one, are both
 * states every individual step would report as healthy.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BOT_AUTHOR,
  hasForeignCommits,
  main,
  parseArgs,
} = require("./vendor-pr.cjs");

const ARGV = [
  "--branch",
  "vendor/vale",
  "--title",
  "chore(vale): pin Vale 3.21.0",
  "--body-file",
  "/tmp/body.md",
  "--message",
  "chore(vale): pin Vale 3.21.0",
  "--",
  ".github/scripts/vale-manifest.json",
];

/**
 * Drive main() with both commands recorded.
 *
 * `git` answers are keyed by the subcommand plus enough of its arguments to be
 * unambiguous. `undefined` from the runner means the command failed, which is
 * how the real one reports a non-zero exit under `allowFailure`.
 */
function harness({ gitAnswers = {}, ghAnswers = {} } = {}) {
  const calls = [];
  const answer = (table, args, fallback) => {
    for (const [key, value] of Object.entries(table)) {
      if (args.join(" ").startsWith(key)) {
        return value;
      }
    }
    return fallback;
  };
  return {
    calls,
    git: (args) => {
      calls.push(["git", ...args]);
      return answer(gitAnswers, args, "");
    },
    gh: (args) => {
      calls.push(["gh", ...args]);
      return answer(ghAnswers, args, "");
    },
    log: () => {},
  };
}

const ran = (calls, command, ...prefix) =>
  calls.some(
    ([name, ...args]) =>
      name === command && prefix.every((part, index) => args[index] === part)
  );

test("args: paths come after `--` and flags before it", () => {
  const options = parseArgs(ARGV);
  assert.equal(options.branch, "vendor/vale");
  assert.deepEqual(options.paths, [".github/scripts/vale-manifest.json"]);
  assert.equal(options.label, undefined);
});

test("args: a missing required flag aborts", () => {
  assert.throws(() => parseArgs(ARGV.slice(2)), /--branch is required/);
});

test("args: no paths at all aborts rather than committing nothing", () => {
  assert.throws(
    () => parseArgs(ARGV.slice(0, ARGV.indexOf("--"))),
    /no paths to stage/
  );
});

test("guard: the workflow's own commits are not foreign", () => {
  assert.equal(hasForeignCommits([BOT_AUTHOR]), false);
  assert.equal(hasForeignCommits([]), false);
  assert.equal(hasForeignCommits([""]), false);
});

test("guard: anyone else's commit is foreign", () => {
  assert.equal(hasForeignCommits(["A Reviewer"]), true);
});

test("no remote branch yet: pushes and opens a pull request", async () => {
  // `diff --cached --quiet` fails when something is staged, which is the
  // healthy path; `ls-remote --exit-code` fails when the branch is absent.
  const h = harness({
    gitAnswers: { "diff --cached": undefined, "ls-remote": undefined },
  });
  const result = await main({ argv: ARGV, ...h });

  assert.deepEqual(result, { action: "created" });
  assert.ok(ran(h.calls, "git", "checkout", "-B", "vendor/vale"));
  assert.ok(ran(h.calls, "git", "push", "--force", "origin", "vendor/vale"));
  assert.ok(ran(h.calls, "gh", "pr", "create"));
  assert.ok(
    !ran(h.calls, "git", "fetch"),
    "fetched a branch that does not exist"
  );
});

test("an open pull request is retitled and rewritten, not duplicated", async () => {
  const h = harness({
    gitAnswers: {
      "diff --cached": undefined,
      "ls-remote": "abc123\trefs/heads/vendor/vale",
      "log -1": BOT_AUTHOR,
      "diff --quiet FETCH_HEAD": undefined, // content differs
    },
    ghAnswers: { "pr list": "73" },
  });
  const result = await main({ argv: ARGV, ...h });

  assert.deepEqual(result, { action: "updated", pr: 73 });
  assert.ok(!ran(h.calls, "gh", "pr", "create"), "opened a duplicate PR");
  // The title has to move with the body: a rolling branch whose PR still names
  // the previous version is worse than no automation, because it reads as
  // current.
  const patch = h.calls.find(
    ([name, ...args]) => name === "gh" && args[0] === "api"
  );
  assert.ok(patch, "did not PATCH the open pull request");
  assert.ok(patch.includes("title=chore(vale): pin Vale 3.21.0"));
  assert.ok(patch.includes("body=@/tmp/body.md"));
});

/**
 * The guard that makes a static branch safe. A scheduled run that finds the
 * same upstream version must be completely inert — otherwise every run rewrites
 * the branch, and every rewrite dismisses approvals and restarts CI on a
 * proposal that has not changed.
 */
test("an unchanged proposal is not re-pushed", async () => {
  const h = harness({
    gitAnswers: {
      "diff --cached": undefined,
      "ls-remote": "abc123\trefs/heads/vendor/vale",
      "log -1": BOT_AUTHOR,
      "diff --quiet FETCH_HEAD": "", // identical content
    },
  });
  const result = await main({ argv: ARGV, ...h });

  assert.deepEqual(result, { action: "none", reason: "unchanged" });
  assert.ok(!ran(h.calls, "git", "push"), "force-pushed an unchanged branch");
  assert.ok(!ran(h.calls, "gh", "pr"), "touched the pull request anyway");
});

/**
 * The guard that protects a reviewer. Pushing a fixup onto the branch is the
 * most reasonable thing a reviewer can do, and a force-push would delete it
 * with nothing reporting the loss.
 */
test("a branch last written by someone else is left alone", async () => {
  const h = harness({
    gitAnswers: {
      "diff --cached": undefined,
      "ls-remote": "abc123\trefs/heads/vendor/vale",
      "log -1": "A Reviewer",
    },
  });
  const result = await main({ argv: ARGV, ...h });

  assert.deepEqual(result, { action: "none", reason: "foreign-commits" });
  assert.ok(!ran(h.calls, "git", "push"), "force-pushed over a reviewer");
});

test("the ownership check happens before the push, not after", async () => {
  const h = harness({
    gitAnswers: {
      "diff --cached": undefined,
      "ls-remote": "abc123\trefs/heads/vendor/vale",
      "log -1": BOT_AUTHOR,
      "diff --quiet FETCH_HEAD": undefined,
    },
    ghAnswers: { "pr list": "" },
  });
  await main({ argv: ARGV, ...h });

  const authorAt = h.calls.findIndex(
    ([name, ...args]) => name === "git" && args[0] === "log"
  );
  const pushAt = h.calls.findIndex(
    ([name, ...args]) => name === "git" && args[0] === "push"
  );
  assert.ok(authorAt !== -1 && pushAt !== -1);
  assert.ok(authorAt < pushAt, "pushed before checking who owns the branch");
});

test("a working tree with no bump in it proposes nothing", async () => {
  const h = harness({ gitAnswers: { "diff --cached": "" } });
  const result = await main({ argv: ARGV, ...h });

  assert.deepEqual(result, { action: "none", reason: "nothing-staged" });
  assert.ok(!ran(h.calls, "git", "commit"), "committed an empty change");
  assert.ok(!ran(h.calls, "git", "push"));
});

test("a label is passed on only when one was asked for", async () => {
  const h = harness({
    gitAnswers: { "diff --cached": undefined, "ls-remote": undefined },
  });
  await main({
    argv: [...ARGV.slice(0, 8), "--label", "skip-changeset", ...ARGV.slice(8)],
    ...h,
  });

  const create = h.calls.find(
    ([name, ...args]) =>
      name === "gh" && args[0] === "pr" && args[1] === "create"
  );
  assert.ok(create.includes("skip-changeset"));
});

/**
 * The narrower half of the unchanged guard, and the one that was wrong first.
 * Comparing whole trees made an unrelated commit on `main` look like a changed
 * proposal, so a quiet upstream still force-pushed the branch and dismissed the
 * pull request's approvals over somebody else's edit to a different file.
 */
test("the unchanged check looks only at the paths being proposed", async () => {
  const h = harness({
    gitAnswers: {
      "diff --cached": undefined,
      "ls-remote": "abc123\trefs/heads/vendor/vale",
      "log -1": BOT_AUTHOR,
      "diff --quiet FETCH_HEAD": "",
    },
  });
  await main({ argv: ARGV, ...h });

  const compare = h.calls.find(
    ([name, ...args]) =>
      name === "git" && args[0] === "diff" && args[2] === "FETCH_HEAD"
  );
  assert.ok(compare.includes("--"), "compared whole trees, not the proposal");
  assert.ok(compare.includes(".github/scripts/vale-manifest.json"));
});
