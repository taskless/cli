// SPDX-License-Identifier: MIT
"use strict";

/**
 * Shared plumbing for the iterate-pr scripts: running `gh` and `git`, and
 * deriving stack lineage from the open pull requests.
 *
 * Zero dependencies, CommonJS, stdlib only — the same shape as
 * `.github/scripts/*.cjs`, so `node --test` covers these without a second
 * toolchain. Every function that touches the outside world takes its runner as
 * an argument, so tests drive them without a network or a repository.
 */

const { spawnSync } = require("node:child_process");

/**
 * A message meant for the user, not a stack trace.
 *
 * The Python originals called `sys.exit("error: …")`, which prints and exits 1
 * in one step. Throwing instead keeps the decision to exit inside `main`, where
 * a test can observe it, rather than inside a helper that would take the test
 * process down with it.
 */
class FatalError extends Error {}

/**
 * A bad command-line argument, as opposed to a runtime failure.
 *
 * Python's `argparse` exited 2 for these and 1 for a `sys.exit("error: …")`,
 * and callers (and CI) can tell the two apart by that code. Keeping the
 * distinction means a typo in a flag never looks like the API being down.
 */
class UsageError extends FatalError {}

/**
 * Parse an integer option, rejecting anything that is not one.
 *
 * `Number("abc")` is `NaN`, which is the dangerous answer rather than the
 * obviously-wrong one: it flows onward, every comparison against it is false,
 * and a guard written as `actual > limit` silently never fires. Python's
 * `argparse(type=int)` refused up front and this restores that.
 */
const parseIntegerOption = (name, raw) => {
  if (raw === undefined) return undefined;
  if (!/^-?\d+$/.test(String(raw).trim())) {
    throw new UsageError(`error: --${name} expects an integer, got '${raw}'`);
  }
  return Number(raw);
};

/**
 * Run a command and return `{ code, stdout, stderr, timedOut }`, never throwing.
 *
 * `timeoutMs` matters for anything on the polling path: a call that hangs
 * rather than failing freezes the whole iterate loop with no way out short of
 * killing the process, which is worse than an error. A timed-out call reports
 * `timedOut`, so a caller can tell "gave up" from "failed".
 */
const runProcess = (command, args, { timeoutMs } = {}) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
  });
  if (result.error) {
    return {
      code: -1,
      stdout: "",
      stderr: String(result.error.message),
      timedOut: result.error.code === "ETIMEDOUT",
    };
  }
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: false,
  };
};

/** Run `git` with the given arguments. Never goes through a shell, so branch
 * names with slashes or dots and unmatched globs are non-issues. */
const runGit = (...args) => runProcess("git", args);

/** Stripped stdout of a successful `git` call, or "" on any failure. */
const gitOut = (run, ...args) => {
  const result = run(...args);
  return result.code === 0 ? result.stdout.trim() : "";
};

/**
 * Run `gh` and parse its stdout as JSON.
 *
 * Returns null on a non-zero exit (reporting gh's own stderr), on empty output,
 * and on unparseable output — the three cases the callers all treat the same
 * way, which is to fall back to an empty result rather than crash.
 */
const runGh = (args, { run = runProcess, log = console.error } = {}) => {
  const result = run("gh", args);
  if (result.code !== 0) {
    log(`Error running gh ${args.join(" ")}: ${result.stderr}`);
    return null;
  }
  if (!result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
};

/**
 * `gh pr view`, for a given PR or for the current branch.
 *
 * The number goes BEFORE `--json`, which is why this is worth sharing rather
 * than writing twice: `gh pr view --json x 299` is not the same command.
 */
const prView = (fields, prNumber, options) => {
  const args = ["pr", "view", "--json", fields];
  if (prNumber) args.splice(2, 0, String(prNumber));
  return runGh(args, options);
};

/**
 * child -> parent, derived from the open GitHub PRs (each PR's head -> base).
 *
 * GitHub's PR base/head is the shared, portable source of truth for stack
 * topology — the same edges the stack-breadcrumb CI reads — so no local config
 * is needed. A branch stacked on another has that branch as its base; a root
 * branch's base is main.
 *
 * Throws on a gh error (unauthenticated, offline, API down) rather than
 * returning an empty map. An empty map would masquerade as "no descendants" and
 * let a propagation run exit 0 having silently skipped everything.
 */
const lineage = ({ run = runProcess } = {}) => {
  const result = run("gh", [
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "200",
    "--json",
    "headRefName,baseRefName",
  ]);
  if (result.code !== 0) {
    throw new FatalError(
      "error: `gh pr list` failed; cannot derive stack lineage:\n" +
        (result.stderr.trim() || "(no stderr from gh)")
    );
  }
  let prs;
  try {
    prs = JSON.parse(result.stdout || "[]");
  } catch (error) {
    throw new FatalError(
      `error: could not parse \`gh pr list\` output as JSON: ${error.message}`
    );
  }
  const edges = {};
  for (const pr of Array.isArray(prs) ? prs : []) {
    const head = pr?.headRefName;
    const base = pr?.baseRefName;
    if (head && base) edges[head] = base;
  }
  return edges;
};

/** Whether a ref resolves. */
const refExists = (run, ref) =>
  run("rev-parse", "--verify", "--quiet", ref).code === 0;

/** Whether `ancestor` is reachable from `descendant`. */
const isAncestor = (run, ancestor, descendant) =>
  run("merge-base", "--is-ancestor", ancestor, descendant).code === 0;

/** Commit count for a range expression, or -1 when git could not answer. */
const countRange = (run, rangeExpression) => {
  const out = gitOut(run, "rev-list", "--count", rangeExpression);
  return /^\d+$/.test(out) ? Number(out) : -1;
};

/**
 * Descendants of `root` in parent-before-child order.
 *
 * `seen` is load-bearing, not defensive: GitHub permits a base cycle (A based
 * on B while B is based on A), which would otherwise spin here forever — and
 * this is the walk that drives rebases and force-pushes.
 */
const orderedDescendants = (root, edges) => {
  const children = {};
  for (const [child, parent] of Object.entries(edges)) {
    (children[parent] ??= []).push(child);
  }
  const ordered = [];
  const seen = new Set([root]);
  const stack = [root];
  while (stack.length > 0) {
    const branch = stack.pop();
    for (const child of [...(children[branch] ?? [])].sort()) {
      if (seen.has(child)) continue;
      seen.add(child);
      ordered.push(child);
      stack.push(child);
    }
  }
  return ordered;
};

module.exports = {
  FatalError,
  UsageError,
  countRange,
  gitOut,
  isAncestor,
  lineage,
  orderedDescendants,
  parseIntegerOption,
  prView,
  refExists,
  runGh,
  runGit,
  runProcess,
};
