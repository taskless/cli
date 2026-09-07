#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * Resolve PR review threads by their GraphQL node IDs.
 *
 * Usage:
 *     node resolve_pr_threads.cjs THREAD_ID [THREAD_ID ...]
 *
 * Each THREAD_ID is a GraphQL node ID (e.g., PRRT_kwDOQLIDeM51Bg43).
 *
 * Output: JSON to stdout with results for each thread.
 *
 * Example output:
 * {
 *   "resolved": ["PRRT_kwDOQLIDeM51Bg43", "PRRT_kwDOQLIDeM51Bg5G"],
 *   "failed": [],
 *   "already_resolved": []
 * }
 */

const { runProcess } = require("./shared.cjs");

const IS_RESOLVED_QUERY =
  "query($threadId: ID!) { node(id: $threadId) " +
  "{ ... on PullRequestReviewThread { isResolved } } }";

const RESOLVE_MUTATION =
  "mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) " +
  "{ thread { isResolved } } }";

/**
 * Run a GraphQL query via `gh api`, passing the node ID as a variable.
 *
 * The ID goes through -F rather than being interpolated into the query text, so
 * it is never parsed as GraphQL syntax.
 */
const runGraphql = (run, query, threadId) => {
  const result = run("gh", [
    "api",
    "graphql",
    "-F",
    `threadId=${threadId}`,
    "-f",
    `query=${query}`,
  ]);
  if (result.code !== 0) {
    return { errors: [{ message: result.stderr.trim() }] };
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return {
      errors: [
        { message: `could not parse gh output as JSON: ${error.message}` },
      ],
    };
  }
};

/** Whether a thread is already resolved. Null on error. */
const checkThreadResolved = (run, threadId) => {
  const data = runGraphql(run, IS_RESOLVED_QUERY, threadId);
  const node = data?.data?.node;
  if (node === null || node === undefined) return null;
  return node.isResolved ?? false;
};

/** Resolve a single review thread. True on success. */
const resolveThread = (run, threadId) => {
  const data = runGraphql(run, RESOLVE_MUTATION, threadId);
  return data?.data?.resolveReviewThread?.thread?.isResolved ?? false;
};

/** Sort every thread id into resolved / already_resolved / failed. */
const resolveAll = (threadIds, { run = runProcess } = {}) => {
  const resolved = [];
  const failed = [];
  const alreadyResolved = [];

  for (const threadId of threadIds) {
    if (checkThreadResolved(run, threadId) === true) {
      alreadyResolved.push(threadId);
      continue;
    }
    if (resolveThread(run, threadId)) {
      resolved.push(threadId);
    } else {
      failed.push(threadId);
    }
  }

  return { resolved, failed, already_resolved: alreadyResolved };
};

const main = ({ argv = process.argv.slice(2), run = runProcess } = {}) => {
  if (argv.length === 0) {
    console.error(
      "usage: resolve_pr_threads.cjs THREAD_ID [THREAD_ID ...]\n" +
        "error: at least one THREAD_ID is required"
    );
    return { output: null, code: 2 };
  }
  const output = resolveAll(argv, { run });
  return { output, code: output.failed.length > 0 ? 1 : 0 };
};

if (require.main === module) {
  const { output, code } = main({});
  if (output) console.log(JSON.stringify(output, null, 2));
  process.exit(code);
}

module.exports = { checkThreadResolved, main, resolveAll, resolveThread };
