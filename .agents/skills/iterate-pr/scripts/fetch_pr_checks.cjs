#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * Fetch PR CI checks and extract relevant failure snippets.
 *
 * Usage:
 *     node fetch_pr_checks.cjs [--pr PR_NUMBER]
 *
 * If --pr is not specified, uses the PR for the current branch.
 *
 * Output: JSON to stdout with structured check data.
 */

const { parseArgs } = require("node:util");

const { runGh, runProcess } = require("./shared.cjs");

/**
 * Patterns that indicate a failure point, matched case-insensitively.
 *
 * Deliberately broad: a snippet with extra context costs a few lines of reading,
 * while a missed failure costs a whole log.
 */
const FAILURE_PATTERN = new RegExp(
  [
    String.raw`error[:\s]`,
    String.raw`failed[:\s]`,
    String.raw`failure[:\s]`,
    "traceback",
    "exception",
    String.raw`assert(ion)?.*failed`,
    "FAILED",
    "panic:",
    "fatal:",
    "npm ERR!",
    "yarn error",
    "ModuleNotFoundError",
    "ImportError",
    "SyntaxError",
    "TypeError",
    "ValueError",
    "KeyError",
    "AttributeError",
    "NameError",
    "IndentationError",
    String.raw`===.*FAILURES.*===`,
    "___.*___",
  ].join("|"),
  "i"
);

/** PR info, by number or for the current branch. */
const getPrInfo = (prNumber, options) => {
  const args = ["pr", "view", "--json", "number,url,headRefName,baseRefName"];
  if (prNumber) args.splice(2, 0, String(prNumber));
  return runGh(args, options);
};

/**
 * Parse `gh pr checks` output, which is tab-separated rather than JSON.
 *
 * `gh pr checks` exits non-zero when any check has failed, which is the case
 * this script exists to report — so the exit code is deliberately ignored and
 * only stdout is read.
 */
const parseChecks = (stdout) => {
  if (!stdout.trim()) return [];
  const checks = [];
  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    checks.push({
      name: parts[0].trim(),
      bucket: parts[1].trim(),
      link: parts.length > 3 ? parts[3].trim() : "",
      workflow: "",
    });
  }
  return checks;
};

const getChecks = (prNumber, { run = runProcess } = {}) => {
  const args = ["pr", "checks"];
  if (prNumber) args.push(String(prNumber));
  const result = run("gh", args);
  return parseChecks(result.stdout ?? "");
};

/** Recent failed workflow runs for a branch. */
const getFailedRuns = (branch, options) => {
  const result = runGh(
    [
      "run",
      "list",
      "--branch",
      branch,
      "--limit",
      "10",
      "--json",
      "databaseId,name,status,conclusion,headSha",
    ],
    options
  );
  if (!Array.isArray(result)) return [];
  return result.filter((r) => r?.conclusion === "failure");
};

/**
 * Extract the relevant failure snippet from log text.
 *
 * Anchors on the first failure marker and takes context around it, rather than
 * the tail: a job that fails early then prints a long teardown would otherwise
 * report only the teardown.
 */
const extractFailureSnippet = (logText, maxLines = 50) => {
  const lines = logText.split("\n");

  const failureIndices = [];
  for (const [index, line] of lines.entries()) {
    if (FAILURE_PATTERN.test(line)) failureIndices.push(index);
  }

  if (failureIndices.length === 0) {
    // No clear failure point; the tail is the best guess available.
    return lines.slice(-maxLines).join("\n");
  }

  const firstFailure = failureIndices[0];
  const start = Math.max(0, firstFailure - 5);
  const end = Math.min(lines.length, firstFailure + maxLines - 5);
  const snippet = lines.slice(start, end);

  const remaining = failureIndices.filter((index) => index >= end);
  if (remaining.length > 0) {
    snippet.push(`\n... (${remaining.length} more error(s) follow)`);
  }

  return snippet.join("\n");
};

/** Failed logs for a workflow run, or null when gh produced nothing. */
const getRunLogs = (runId, { run = runProcess } = {}) => {
  const result = run("gh", ["run", "view", String(runId), "--log-failed"]);
  return result.stdout || result.stderr || null;
};

/** Attach a log snippet to every failing check, fetching runs at most once. */
const decorateChecks = (checks, branch, options = {}) => {
  let failedRuns = null;
  const decorated = [];

  for (const check of checks) {
    const processed = {
      name: check.name ?? "unknown",
      status: check.bucket ?? check.state ?? "unknown",
      link: check.link ?? "",
      workflow: check.workflow ?? "",
    };

    if (processed.status === "fail") {
      failedRuns ??= getFailedRuns(branch, options);
      const workflowName = processed.workflow || processed.name;
      const match = failedRuns.find((r) =>
        (r.name ?? "").includes(workflowName)
      );
      if (match) {
        const logs = getRunLogs(match.databaseId, options);
        if (logs) {
          processed.log_snippet = extractFailureSnippet(logs);
          processed.run_id = match.databaseId;
        }
      }
    }

    decorated.push(processed);
  }

  return decorated;
};

const summarize = (checks) => ({
  total: checks.length,
  passed: checks.filter((c) => c.status === "pass").length,
  failed: checks.filter((c) => c.status === "fail").length,
  pending: checks.filter((c) => c.status === "pending").length,
  skipped: checks.filter(
    (c) => c.status === "skipping" || c.status === "cancel"
  ).length,
});

const main = ({
  argv = process.argv.slice(2),
  run = runProcess,
  log = console.error,
} = {}) => {
  const { values } = parseArgs({
    args: argv,
    options: { pr: { type: "string" } },
  });
  const options = { run, log };
  const prNumber = values.pr ? Number(values.pr) : undefined;

  const prInfo = getPrInfo(prNumber, options);
  if (!prInfo) {
    return { output: { error: "No PR found for current branch" }, code: 1 };
  }

  const branch = prInfo.headRefName;
  const checks = decorateChecks(
    getChecks(prInfo.number, options),
    branch,
    options
  );

  return {
    output: {
      pr: {
        number: prInfo.number,
        url: prInfo.url ?? "",
        branch,
        base: prInfo.baseRefName ?? "",
      },
      summary: summarize(checks),
      checks,
    },
    code: 0,
  };
};

if (require.main === module) {
  const { output, code } = main({});
  console.log(JSON.stringify(output, null, 2));
  process.exit(code);
}

module.exports = {
  decorateChecks,
  extractFailureSnippet,
  main,
  parseChecks,
  summarize,
};
