#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * Cascade-rebase a branch's descendants onto their parents — safely, WITHOUT
 * touching main.
 *
 * Use after you commit a fix on branch X and want it carried up to every branch
 * stacked on top of X. Unlike a whole-stack sync, this never rebases onto the
 * latest main — fix-propagation stays decoupled from main-reconciliation, and
 * parents are taken as-is (main is never pulled in).
 *
 * Lineage is read from the open GitHub PRs (each PR's head -> base), which is
 * the shared, portable source of truth for stack topology — the same edges the
 * stack-breadcrumb CI reads. No local config (or any per-machine state) is
 * required. Processing is topological: a child is rebased only after its parent.
 *
 * SAFETY GUARDS:
 *   * Balloon guard — before each rebase the branch's own-commit count is
 *     recorded (upstream..child). A rebase can only ever DROP own commits
 *     (patch-equivalent ones already in the parent), never add them, so any
 *     increase means the rebase landed on the wrong parent and swept in the
 *     upper stack. On an increase — or on exceeding the absolute --max-own
 *     ceiling — the script RESETS the branch back to origin and aborts WITHOUT
 *     pushing. This is the guard that would have prevented force-pushing
 *     garbage to a PR.
 *   * Checkout — a failed checkout (dirty tree, index lock) aborts immediately.
 *     Continuing would rebase and force-push whichever branch was checked out.
 *   * Conflict — on a rebase conflict the rebase is aborted, the conflicting
 *     files are reported, and the script stops (that boundary needs manual
 *     reconcile).
 *   * Push uses --force-with-lease against a freshly fetched origin; the lease
 *     is only meaningful if remote-tracking refs are current, so we fetch first.
 *
 *     node ${CLAUDE_SKILL_ROOT}/scripts/propagate_stack.cjs --root <branch> [--dry-run] [--no-push]
 */

const { parseArgs } = require("node:util");

const {
  FatalError,
  countRange,
  gitOut,
  lineage,
  orderedDescendants,
  refExists,
  runGit,
} = require("./shared.cjs");

/**
 * The commit `child` last forked from `parent`, as a rebase upstream.
 *
 * A plain `git rebase <parent>` picks its upstream by merge-base, which is
 * WRONG the moment `parent` has been rewritten: the merge-base falls back to an
 * older common ancestor, so commits the parent already superseded get replayed
 * onto their own replacements. That surfaces as a conflict in files the child
 * never touched, and the obvious resolution — "take mine" — silently discards
 * the parent's newer work. The child's own tests still pass, because the change
 * that was lost belongs to the parent.
 *
 * Three sources, most reliable first:
 *
 * 1. `rewritten` — a parent this run rebased itself, so its pre-rebase tip is
 *    known exactly. Processing is parent-before-child, so by the time a child is
 *    reached its parent's entry is already recorded.
 * 2. `git merge-base --fork-point` — reads the parent's reflog to find where the
 *    child forked, which survives a rewrite this run did not perform (a parent
 *    restacked by hand, or in an earlier run).
 * 3. The parent itself — correct whenever the parent was only appended to.
 */
const forkUpstream = (git, parent, child, rewritten) => {
  const known = rewritten[parent];
  if (known) return known;
  const probe = git("merge-base", "--fork-point", parent, child);
  if (probe.code === 0 && probe.stdout.trim()) return probe.stdout.trim();
  return parent;
};

const main = ({
  argv = process.argv.slice(2),
  git = runGit,
  gh = undefined,
  emit = console.log,
} = {}) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "no-push": { type: "boolean", default: false },
      "max-own": { type: "string", default: "15" },
    },
  });

  if (!values.root) {
    throw new FatalError("error: --root is required");
  }
  const root = values.root;
  const maxOwn = Number(values["max-own"]);

  const edges = lineage(gh ? { run: gh } : {});
  if (!Object.values(edges).includes(root) && !(root in edges)) {
    emit(`'${root}' has no descendants in lineage (nothing to propagate).`);
    return 0;
  }

  const plan = orderedDescendants(root, edges);
  if (plan.length === 0) {
    emit(`'${root}' has no descendants. Nothing to do.`);
    return 0;
  }

  emit(`Propagation plan (root ${root}), parent-before-child:`);
  for (const branch of plan) {
    emit(`  ${String(edges[branch]).padEnd(30)} -> ${branch}`);
  }
  if (values["dry-run"]) {
    emit("\n(dry-run) no changes made.");
    return 0;
  }

  // --force-with-lease compares against remote-tracking refs, so a stale
  // origin/* silently degrades it to a plain --force. Refresh before pushing.
  if (!values["no-push"]) {
    const fetch = git("fetch", "origin");
    if (fetch.code !== 0) {
      emit(
        "  ✗ `git fetch origin` failed; --force-with-lease would be " +
          `unsafe against stale refs. Not pushing.\n${fetch.stderr.trim()}`
      );
      return 5;
    }
  }

  const start = gitOut(git, "rev-parse", "--abbrev-ref", "HEAD");
  // Pre-rebase tip of every branch this run rewrites, so each child can be
  // replayed from where it actually forked rather than from a merge-base that a
  // rewritten parent has already invalidated.
  const rewritten = {};

  for (const child of plan) {
    const parent = edges[child];
    if (!refExists(git, child) || !refExists(git, parent)) {
      emit(
        `  · skip ${child} (missing ${refExists(git, child) ? parent : child})`
      );
      continue;
    }

    const upstream = forkUpstream(git, parent, child, rewritten);
    // The guard counts from the SAME upstream the rebase replays from. Counting
    // from a merge-base a rewritten parent has invalidated inflates the
    // expectation with the parent's own superseded commits, which makes the
    // guard fire late or not at all.
    const expectedOwn = countRange(git, `${upstream}..${child}`);

    const checkout = git("checkout", child);
    if (checkout.code !== 0) {
      emit(
        `  ✗ could not check out ${child}; aborting before any rebase ` +
          "(otherwise the CURRENT branch would be rebased and force-pushed):" +
          `\n${checkout.stderr.trim()}`
      );
      return 6;
    }

    const before = gitOut(git, "rev-parse", child);
    const rebase = git("rebase", "--onto", parent, upstream);
    if (rebase.code !== 0) {
      const conflicts = gitOut(git, "diff", "--name-only", "--diff-filter=U");
      git("rebase", "--abort");
      emit(
        `  ✗ CONFLICT: ${child} onto ${parent} (from ${upstream.slice(0, 9)}). ` +
          "Needs manual reconcile:"
      );
      for (const file of conflicts.split("\n").filter(Boolean)) {
        emit(`        ${file}`);
      }
      if (start) git("checkout", start);
      return 2;
    }

    if (before) rewritten[child] = before;
    const actualOwn = countRange(git, `${parent}..${child}`);
    // A rebase can only drop own commits, never gain them, so ANY increase is a
    // balloon. --max-own is a separate absolute ceiling for the case where
    // expectedOwn could not be computed (no merge-base).
    const ballooned = expectedOwn >= 0 ? actualOwn > expectedOwn : false;
    if (ballooned || actualOwn > maxOwn) {
      emit(
        `  ✗ BALLOON GUARD: ${child} has ${actualOwn} commits above ${parent} ` +
          `(expected at most ${expectedOwn >= 0 ? expectedOwn : maxOwn}). ` +
          "Likely rebased onto the wrong parent. NOT pushing."
      );
      const reset = git("reset", "--hard", `origin/${child}`);
      if (reset.code === 0) {
        emit(`        reset ${child} back to origin/${child}.`);
      } else {
        emit(
          `        COULD NOT reset to origin/${child} (unpushed branch?); ` +
            `${child} is left rebased locally and needs manual repair:` +
            `\n${reset.stderr.trim()}`
        );
      }
      if (start) git("checkout", start);
      return 3;
    }

    if (values["no-push"]) {
      emit(
        `  ✓ ${child} rebased onto ${parent} (+${actualOwn} own) — not pushed (--no-push)`
      );
      continue;
    }

    // Explicit remote + branch: never rely on push.default to infer the ref.
    const push = git("push", "--force-with-lease", "origin", child);
    if (push.code !== 0) {
      emit(`  ✗ push failed for ${child}:\n${push.stderr.trim()}`);
      if (start) git("checkout", start);
      return 4;
    }
    emit(`  ✓ ${child} rebased onto ${parent} (+${actualOwn} own) — pushed`);
  }

  if (start) git("checkout", start);
  emit("\nPropagation complete.");
  return 0;
};

if (require.main === module) {
  try {
    process.exit(main({}));
  } catch (error) {
    if (error instanceof FatalError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

module.exports = { forkUpstream, main };
