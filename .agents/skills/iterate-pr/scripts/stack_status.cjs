#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * Report the health of a PR stack.
 *
 * Lineage is derived from the open GitHub PRs (each PR's head -> base), the
 * shared, portable source of truth for stack topology. For every branch with a
 * parent, prints:
 *   - parent (lineage edge)
 *   - ahead/behind vs origin/<branch>
 *   - own-commit count (commits unique to the branch above its parent)
 *   - whether it is CLEANLY STACKED (parent tip is an ancestor of the branch) or
 *     DIVERGED (parent tip is NOT an ancestor — the branch was never rebased
 *     onto the current parent and needs a restack before propagation is
 *     meaningful)
 *
 * Run from anywhere in the repo; operates purely on refs, independent of the
 * currently checked-out branch.
 *
 *     node ${CLAUDE_SKILL_ROOT}/scripts/stack_status.cjs [--root <branch>]
 */

const { parseArgs } = require("node:util");

const {
  FatalError,
  UsageError,
  countRange,
  gitOut,
  isAncestor,
  lineage,
  orderedDescendants,
  refExists,
  runGit,
} = require("./shared.cjs");

/** (behind, ahead) of b relative to a, i.e. the counts for `a...b`. */
const aheadBehind = (git, a, b) => {
  const out = gitOut(git, "rev-list", "--left-right", "--count", `${a}...${b}`);
  if (!out) return [-1, -1];
  const [left, right] = out.split("\t");
  if (!/^\d+$/.test(left ?? "") || !/^\d+$/.test(right ?? "")) return [-1, -1];
  return [Number(left), Number(right)];
};

/**
 * Every branch reachable below `root`.
 *
 * One walk, shared with propagate_stack, rather than a second copy that has to
 * be kept in sync by hand. Ordering is irrelevant here (the result is only used
 * as a filter) but the cycle handling is not: the shared walk seeds `seen` with
 * `root`, so a base cycle terminates and never reports the root as its own
 * descendant.
 */
const descendants = (root, edges) => new Set(orderedDescendants(root, edges));

/** One report row per branch, as data — the printing is separate and dumb. */
const inspectBranches = (branches, edges, git) => {
  const rows = [];
  for (const branch of branches) {
    const parent = edges[branch];
    if (!refExists(git, branch)) {
      rows.push({ branch, parent, missing: true });
      continue;
    }
    const [behind, ahead] = refExists(git, `origin/${branch}`)
      ? aheadBehind(git, `origin/${branch}`, branch)
      : [-1, -1];
    const parentExists = refExists(git, parent);
    rows.push({
      branch,
      parent,
      behind,
      ahead,
      clean: parentExists ? isAncestor(git, parent, branch) : false,
      own: parentExists ? countRange(git, `${parent}..${branch}`) : -1,
      missing: false,
    });
  }
  return rows;
};

const pad = (value, width) => String(value).padEnd(width);
const padLeft = (value, width) => String(value).padStart(width);

const formatReport = (rows) => {
  const lines = [
    `${pad("branch", 40)} ${pad("parent", 28)} ${padLeft("behind/ahead", 12)}  ${padLeft("own", 4)}  state`,
    "-".repeat(100),
  ];
  const diverged = [];

  for (const row of rows) {
    if (row.missing) {
      lines.push(
        `${pad(row.branch, 40)} ${pad(row.parent, 28)} ${padLeft("(no local)", 12)}`
      );
      continue;
    }
    const ab = row.behind >= 0 ? `${row.behind}/${row.ahead}` : "no-origin";
    if (!row.clean) diverged.push(row);
    lines.push(
      `${pad(row.branch, 40)} ${pad(row.parent, 28)} ${padLeft(ab, 12)}  ${padLeft(row.own, 4)}  ${row.clean ? "clean" : "DIVERGED (restack)"}`
    );
  }

  lines.push("-".repeat(100));
  if (diverged.length > 0) {
    lines.push(
      `\n⚠  ${diverged.length} branch(es) diverged from their parent (need a restack):`
    );
    for (const row of diverged) {
      lines.push(
        `     ${row.branch}  (parent ${row.parent} is not an ancestor)`
      );
    }
  } else {
    lines.push("\n✓ every branch is cleanly stacked on its parent.");
  }
  return lines;
};

const main = ({
  argv = process.argv.slice(2),
  git = runGit,
  gh = undefined,
} = {}) => {
  const { values } = parseArgs({
    args: argv,
    options: { root: { type: "string" } },
  });

  const edges = lineage(gh ? { run: gh } : {});
  if (Object.keys(edges).length === 0) {
    return {
      lines: [
        "No stack lineage found (no open PRs, or `gh` is unavailable/unauthenticated).",
      ],
      code: 1,
    };
  }

  let branches = Object.keys(edges).sort();
  if (values.root) {
    const subtree = descendants(values.root, edges);
    subtree.add(values.root);
    branches = branches.filter((b) => subtree.has(b));
  }

  return {
    lines: formatReport(inspectBranches(branches, edges, git)),
    code: 0,
  };
};

if (require.main === module) {
  try {
    const { lines, code } = main({});
    for (const line of lines) console.log(line);
    process.exit(code);
  } catch (error) {
    if (error instanceof FatalError) {
      console.error(error.message);
      process.exit(error instanceof UsageError ? 2 : 1);
    }
    throw error;
  }
}

module.exports = {
  aheadBehind,
  descendants,
  formatReport,
  inspectBranches,
  main,
};
