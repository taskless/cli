// SPDX-License-Identifier: MIT
"use strict";

/** Tests for stack_status.cjs. Every git call is a fake; no repository needed. */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  aheadBehind,
  descendants,
  formatReport,
  inspectBranches,
  main,
} = require("./stack_status.cjs");

/**
 * A fake `git` driven by a repository description.
 *
 * `refs` is the set of refs that exist; `ancestors` maps "parent->child" to
 * whether the parent tip is an ancestor; `counts` answers rev-list.
 */
const fakeGit =
  ({ refs = [], ancestors = {}, counts = {} } = {}) =>
  (...args) => {
    const ok = (stdout) => ({ code: 0, stdout, stderr: "" });
    const fail = { code: 1, stdout: "", stderr: "" };
    const [subcommand] = args;

    if (subcommand === "rev-parse") {
      return refs.includes(args.at(-1)) ? ok(args.at(-1)) : fail;
    }
    if (subcommand === "merge-base") {
      return ancestors[`${args[2]}->${args[3]}`] ? ok("") : fail;
    }
    if (subcommand === "rev-list") {
      const key = args.at(-1);
      return key in counts ? ok(String(counts[key])) : fail;
    }
    return fail;
  };

test("descendants collects the whole subtree and ignores unrelated branches", () => {
  const edges = { a: "root", b: "a", c: "b", elsewhere: "main" };
  assert.deepEqual([...descendants("root", edges)].sort(), ["a", "b", "c"]);
  assert.deepEqual([...descendants("leaf", edges)], []);
});

// GitHub permits a base cycle (A based on B while B is based on A). The walk
// must terminate, and must not report the root as its own descendant — which
// the second copy of this walk used to do, harmlessly but only by accident,
// because main() re-added the root immediately afterwards.
test("descendants terminates on a base cycle without including the root", () => {
  assert.deepEqual([...descendants("a", { a: "b", b: "a" })], ["b"]);
});

test("aheadBehind reads git's left/right counts, and -1 when it cannot", () => {
  assert.deepEqual(
    aheadBehind(() => ({ code: 0, stdout: "2\t5", stderr: "" }), "a", "b"),
    [2, 5]
  );
  assert.deepEqual(
    aheadBehind(() => ({ code: 1, stdout: "", stderr: "" }), "a", "b"),
    [-1, -1]
  );
  assert.deepEqual(
    aheadBehind(() => ({ code: 0, stdout: "junk", stderr: "" }), "a", "b"),
    [-1, -1]
  );
});

test("a branch whose parent tip is an ancestor is clean", () => {
  const git = fakeGit({
    refs: ["child", "origin/child", "parent"],
    ancestors: { "parent->child": true },
    counts: { "parent..child": 3, "origin/child...child": "" },
  });
  const [row] = inspectBranches(["child"], { child: "parent" }, git);
  assert.equal(row.clean, true);
  assert.equal(row.own, 3);
});

// DIVERGED is the state that matters: the branch was never rebased onto the
// current parent, so propagating a fix through it is meaningless until it is
// restacked.
test("a branch whose parent tip is NOT an ancestor is reported DIVERGED", () => {
  const git = fakeGit({
    refs: ["child", "parent"],
    ancestors: {},
    counts: { "parent..child": 9 },
  });
  const [row] = inspectBranches(["child"], { child: "parent" }, git);
  assert.equal(row.clean, false);
  const report = formatReport([row]).join("\n");
  assert.match(report, /DIVERGED \(restack\)/);
  assert.match(report, /1 branch\(es\) diverged/);
  assert.match(report, /parent parent is not an ancestor/);
});

test("a branch with no local ref is reported as such, not as diverged", () => {
  const rows = inspectBranches(
    ["gone"],
    { gone: "main" },
    fakeGit({ refs: ["main"] })
  );
  assert.equal(rows[0].missing, true);
  const report = formatReport(rows).join("\n");
  assert.match(report, /\(no local\)/);
  assert.match(
    report,
    /every branch is cleanly stacked/,
    "a missing ref is not a divergence"
  );
});

test("a branch with no origin counterpart reports no-origin rather than 0/0", () => {
  const git = fakeGit({
    refs: ["child", "parent"],
    ancestors: { "parent->child": true },
    counts: { "parent..child": 1 },
  });
  const report = formatReport(
    inspectBranches(["child"], { child: "parent" }, git)
  ).join("\n");
  assert.match(report, /no-origin/);
});

test("a missing parent ref cannot be clean, and its own-count is unknown", () => {
  const git = fakeGit({
    refs: ["child"],
    ancestors: { "parent->child": true },
  });
  const [row] = inspectBranches(["child"], { child: "parent" }, git);
  assert.equal(row.clean, false);
  assert.equal(row.own, -1);
});

test("main reports and exits 1 when there is no lineage at all", () => {
  const gh = () => ({ code: 0, stdout: "[]", stderr: "" });
  const { lines, code } = main({ argv: [], gh, git: fakeGit() });
  assert.equal(code, 1);
  assert.match(lines[0], /No stack lineage found/);
});

test("--root narrows the report to that branch's subtree", () => {
  const gh = () => ({
    code: 0,
    stderr: "",
    stdout: JSON.stringify([
      { headRefName: "a", baseRefName: "root" },
      { headRefName: "b", baseRefName: "a" },
      { headRefName: "elsewhere", baseRefName: "main" },
    ]),
  });
  const git = fakeGit({ refs: [] });
  const all = main({ argv: [], gh, git }).lines.join("\n");
  assert.match(all, /elsewhere/);
  const scoped = main({ argv: ["--root", "root"], gh, git }).lines.join("\n");
  assert.match(scoped, /\ba\b/);
  assert.match(scoped, /\bb\b/);
  assert.doesNotMatch(scoped, /elsewhere/);
});
