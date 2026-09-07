// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for propagate_stack.cjs.
 *
 * Every git call is a fake, so nothing here checks out, rebases, or pushes
 * anything. What is asserted is the ARGV the script would have run: the
 * upstream a rebase replays from is the whole subject of #220, and it is only
 * visible in the arguments.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { forkUpstream, main } = require("./propagate_stack.cjs");

/**
 * A fake `git`.
 *
 * Defaults to a healthy repository: every ref exists, every command succeeds,
 * and each branch has one own commit. `overrides` is consulted first, keyed by
 * the joined argv, and may return a partial result or a function of the call
 * index (so a command can fail on the second branch but not the first).
 */
const fakeGit = ({
  head = "start",
  counts = {},
  forkPoints = {},
  overrides = [],
} = {}) => {
  const calls = [];
  const git = (...args) => {
    const line = args.join(" ");
    calls.push(line);
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });

    for (const [needle, result] of overrides) {
      if (line.includes(needle)) {
        return { code: 0, stdout: "", stderr: "", ...result };
      }
    }

    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return ok(head);
    if (args[0] === "rev-parse" && args[1] === "--verify")
      return ok(args.at(-1));
    if (args[0] === "rev-parse") return ok(`sha-of-${args[1]}`);
    if (args[0] === "rev-list") {
      const range = args.at(-1);
      return ok(String(counts[range] ?? 1));
    }
    if (args[0] === "merge-base" && args[1] === "--fork-point") {
      const key = `${args[2]}->${args[3]}`;
      return key in forkPoints
        ? ok(forkPoints[key])
        : { code: 1, stdout: "", stderr: "no fork point" };
    }
    return ok();
  };
  git.calls = calls;
  return git;
};

const ghWith = (prs) => () => ({
  code: 0,
  stderr: "",
  stdout: JSON.stringify(
    prs.map(([head, base]) => ({ headRefName: head, baseRefName: base }))
  ),
});

/** Run main against a fixed stack, collecting the emitted lines. */
const run = (
  argv,
  {
    git,
    prs = [
      ["child", "root"],
      ["root", "main"],
    ],
  }
) => {
  const lines = [];
  const code = main({
    argv,
    git,
    gh: ghWith(prs),
    emit: (line) => lines.push(line),
  });
  return { code, lines: lines.join("\n"), git };
};

// ---------------------------------------------------------------------------
// forkUpstream — the #220 bug
// ---------------------------------------------------------------------------

test("forkUpstream prefers the pre-rebase tip of a parent this run rewrote", () => {
  const git = fakeGit({ forkPoints: { "parent->child": "from-reflog" } });
  assert.equal(
    forkUpstream(git, "parent", "child", { parent: "pre-rebase-tip" }),
    "pre-rebase-tip"
  );
});

test("forkUpstream falls back to the reflog fork-point for a rewrite it did not perform", () => {
  const git = fakeGit({ forkPoints: { "parent->child": "from-reflog" } });
  assert.equal(forkUpstream(git, "parent", "child", {}), "from-reflog");
});

test("forkUpstream falls back to the parent when no fork point is known", () => {
  assert.equal(forkUpstream(fakeGit(), "parent", "child", {}), "parent");
});

test("forkUpstream ignores an empty fork-point answer", () => {
  const git = fakeGit({
    overrides: [["merge-base --fork-point", { code: 0, stdout: "  \n" }]],
  });
  assert.equal(forkUpstream(git, "parent", "child", {}), "parent");
});

/**
 * THIS IS THE #220 REGRESSION. A grandchild must be replayed from where it
 * forked — its parent's PRE-REBASE tip — and not from the parent itself.
 *
 * `git rebase <parent>` picks its upstream by merge-base, which is wrong exactly
 * when the parent was rewritten, and a parent being rewritten is the only reason
 * anyone runs this script. Replaying from the parent replays the parent's own
 * superseded commits on top of their replacements: a conflict in files the child
 * never touched, where "take mine" silently discards the parent's fix, the
 * child's tests still pass, and under rebase-and-merge the stale content reaches
 * main and reverts a fix that already landed.
 */
test("a grandchild is rebased from its parent's pre-rebase tip, not from the parent", () => {
  const git = fakeGit({ forkPoints: { "root->kid": "kid-forked-at" } });
  const { code } = run(["--root", "root", "--no-push"], {
    git,
    prs: [
      ["kid", "root"],
      ["grandkid", "kid"],
      ["root", "main"],
    ],
  });
  assert.equal(code, 0);

  // The fake answers `rev-parse kid` with "sha-of-kid", so that string IS kid's
  // tip as it stood before the first rebase below rewrote it.
  const rebases = git.calls.filter((c) => c.startsWith("rebase --onto"));
  assert.deepEqual(rebases, [
    "rebase --onto root kid-forked-at",
    // NOT "rebase --onto kid kid" — the upstream is where grandkid forked,
    // which is kid's tip BEFORE the line above rewrote it.
    "rebase --onto kid sha-of-kid",
  ]);
});

// The guard has to count from the same upstream the rebase replays from.
// Counting from a merge-base that a rewritten parent has invalidated inflates
// the expectation with the parent's superseded commits, so the guard fires late
// or not at all — which is the failure it exists to prevent.
test("the balloon guard counts from the same upstream the rebase replays from", () => {
  const git = fakeGit({ forkPoints: { "root->child": "forked-at" } });
  run(["--root", "root", "--no-push"], { git });
  assert.ok(
    git.calls.includes("rev-list --count forked-at..child"),
    `expected a count from the fork point, got: ${git.calls.join(" | ")}`
  );
});

// ---------------------------------------------------------------------------
// Safety guards
// ---------------------------------------------------------------------------

test("a ballooned rebase resets to origin and never pushes", () => {
  // One own commit before the rebase, four after: the rebase landed on the
  // wrong parent and swept in the upper stack.
  const git = fakeGit({
    forkPoints: { "root->child": "forked-at" },
    counts: { "forked-at..child": 1, "root..child": 4 },
  });
  const { code, lines } = run(["--root", "root"], { git });

  assert.equal(code, 3);
  assert.match(lines, /BALLOON GUARD/);
  assert.ok(git.calls.includes("reset --hard origin/child"));
  assert.ok(!git.calls.some((c) => c.startsWith("push")), "nothing is pushed");
});

test("a failed reset after a balloon says the branch needs manual repair", () => {
  const git = fakeGit({
    forkPoints: { "root->child": "forked-at" },
    counts: { "forked-at..child": 1, "root..child": 4 },
    overrides: [["reset --hard", { code: 1, stderr: "unknown revision" }]],
  });
  const { code, lines } = run(["--root", "root"], { git });
  assert.equal(code, 3);
  assert.match(lines, /COULD NOT reset/);
  assert.match(lines, /needs manual repair/);
});

// --max-own is the absolute ceiling for the case where the expected count could
// not be computed at all, so there is nothing to compare against.
test("--max-own bounds a branch whose expected own-count is unknown", () => {
  const git = fakeGit({
    counts: { "root..child": 20 },
    overrides: [["rev-list --count root..child", { code: 0, stdout: "20" }]],
  });
  const { code, lines } = run(["--root", "root", "--max-own", "5"], { git });
  assert.equal(code, 3);
  assert.match(lines, /BALLOON GUARD/);
});

test("a conflict aborts the rebase, names the files, and stops the cascade", () => {
  const git = fakeGit({
    overrides: [
      ["rebase --onto", { code: 1, stderr: "CONFLICT" }],
      ["diff --name-only", { code: 0, stdout: "src/a.ts\nsrc/b.ts" }],
    ],
  });
  const { code, lines } = run(["--root", "root"], { git });

  assert.equal(code, 2);
  assert.match(lines, /CONFLICT: child onto root/);
  assert.match(lines, /src\/a\.ts/);
  assert.ok(git.calls.includes("rebase --abort"));
  assert.ok(!git.calls.some((c) => c.startsWith("push")));
  assert.equal(
    git.calls.at(-1),
    "checkout start",
    "returns to the starting branch"
  );
});

// Continuing past a failed checkout would rebase and force-push whichever
// branch happened to be checked out — the worst outcome available here.
test("a failed checkout aborts before any rebase", () => {
  const git = fakeGit({
    overrides: [["checkout child", { code: 1, stderr: "index.lock" }]],
  });
  const { code, lines } = run(["--root", "root"], { git });

  assert.equal(code, 6);
  assert.match(lines, /could not check out child/);
  assert.ok(!git.calls.some((c) => c.startsWith("rebase")));
  assert.ok(!git.calls.some((c) => c.startsWith("push")));
});

// --force-with-lease compares against remote-tracking refs, so a stale origin/*
// silently degrades it to a plain --force.
test("a failed fetch stops the run rather than leasing against stale refs", () => {
  const git = fakeGit({
    overrides: [["fetch origin", { code: 1, stderr: "offline" }]],
  });
  const { code, lines } = run(["--root", "root"], { git });

  assert.equal(code, 5);
  assert.match(lines, /force-with-lease would be/);
  assert.ok(!git.calls.some((c) => c.startsWith("rebase")));
});

test("--no-push skips the fetch and the push, but still rebases", () => {
  const git = fakeGit();
  const { code, lines } = run(["--root", "root", "--no-push"], { git });

  assert.equal(code, 0);
  assert.match(lines, /not pushed \(--no-push\)/);
  assert.ok(git.calls.some((c) => c.startsWith("rebase --onto")));
  assert.ok(!git.calls.some((c) => c.startsWith("fetch")));
  assert.ok(!git.calls.some((c) => c.startsWith("push")));
});

test("a failed push stops the cascade and returns to the starting branch", () => {
  const git = fakeGit({
    overrides: [["push --force-with-lease", { code: 1, stderr: "stale info" }]],
  });
  const { code, lines } = run(["--root", "root"], { git });

  assert.equal(code, 4);
  assert.match(lines, /push failed for child/);
  assert.equal(git.calls.at(-1), "checkout start");
});

test("a successful run pushes with an explicit remote and branch", () => {
  const git = fakeGit();
  const { code, lines } = run(["--root", "root"], { git });

  assert.equal(code, 0);
  assert.match(lines, /Propagation complete/);
  assert.ok(git.calls.includes("push --force-with-lease origin child"));
  assert.equal(git.calls.at(-1), "checkout start");
});

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

test("--dry-run prints the plan and touches nothing", () => {
  const git = fakeGit();
  const { code, lines } = run(["--root", "root", "--dry-run"], { git });

  assert.equal(code, 0);
  assert.match(lines, /Propagation plan \(root root\)/);
  assert.match(lines, /\(dry-run\) no changes made/);
  assert.deepEqual(git.calls, [], "no git command runs at all");
});

test("a root with no descendants is a no-op, not an error", () => {
  const git = fakeGit();
  const { code, lines } = run(["--root", "child"], { git });
  assert.equal(code, 0);
  assert.match(lines, /no descendants/);
  assert.deepEqual(git.calls, []);
});

test("a root absent from the lineage entirely is a no-op", () => {
  const git = fakeGit();
  const { code, lines } = run(["--root", "unknown-branch"], { git });
  assert.equal(code, 0);
  assert.match(lines, /has no descendants in lineage/);
});

test("a branch missing locally is skipped without stopping the cascade", () => {
  const git = fakeGit({
    forkPoints: { "root->child": "forked-at" },
    overrides: [["rev-parse --verify --quiet gone", { code: 1 }]],
  });
  const { code, lines } = run(["--root", "root", "--no-push"], {
    git,
    prs: [
      ["gone", "root"],
      ["child", "root"],
      ["root", "main"],
    ],
  });
  assert.equal(code, 0);
  assert.match(lines, /· skip gone/);
  assert.ok(
    git.calls.includes("rebase --onto root forked-at"),
    "the other branch still runs"
  );
});

test("--root is required", () => {
  assert.throws(
    () => main({ argv: [], git: fakeGit(), gh: ghWith([]), emit: () => {} }),
    /--root is required/
  );
});
