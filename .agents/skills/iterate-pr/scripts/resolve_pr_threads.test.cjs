// SPDX-License-Identifier: MIT
"use strict";

/** Tests for resolve_pr_threads.cjs. No process is spawned. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { main, resolveAll } = require("./resolve_pr_threads.cjs");

/**
 * A `run` that answers the query and the mutation separately, and records the
 * argv of every call so the variable-passing can be asserted on.
 */
const graphqlRun = ({ isResolved, resolveTo, code = 0, stdout }) => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (code !== 0) return { code, stdout: "", stderr: "HTTP 502" };
    if (stdout !== undefined) return { code: 0, stdout, stderr: "" };
    const isMutation = args.some((a) => a.includes("mutation"));
    return {
      code: 0,
      stderr: "",
      stdout: JSON.stringify(
        isMutation
          ? {
              data: {
                resolveReviewThread: { thread: { isResolved: resolveTo } },
              },
            }
          : { data: { node: isResolved === null ? null : { isResolved } } }
      ),
    };
  };
  run.calls = calls;
  return run;
};

test("an already-resolved thread is reported, not re-resolved", () => {
  const run = graphqlRun({ isResolved: true });
  assert.deepEqual(resolveAll(["PRRT_1"], { run }), {
    resolved: [],
    failed: [],
    already_resolved: ["PRRT_1"],
  });
  assert.equal(run.calls.length, 1, "no mutation is sent");
});

test("an unresolved thread is resolved", () => {
  const run = graphqlRun({ isResolved: false, resolveTo: true });
  assert.deepEqual(resolveAll(["PRRT_1"], { run }), {
    resolved: ["PRRT_1"],
    failed: [],
    already_resolved: [],
  });
});

test("a mutation that does not resolve the thread is a failure", () => {
  const run = graphqlRun({ isResolved: false, resolveTo: false });
  assert.deepEqual(resolveAll(["PRRT_1"], { run }).failed, ["PRRT_1"]);
});

// A thread whose status cannot be read (deleted, or a gh error) is NOT assumed
// resolved — it is attempted, and reported as failed if the attempt does not
// take. Assuming the other way would silently report unresolved threads as done.
test("a thread whose status cannot be read is attempted and reported", () => {
  assert.deepEqual(
    resolveAll(["PRRT_1"], { run: graphqlRun({ isResolved: null }) }).failed,
    ["PRRT_1"]
  );
  assert.deepEqual(
    resolveAll(["PRRT_1"], { run: graphqlRun({ code: 1 }) }).failed,
    ["PRRT_1"]
  );
});

test("unparseable gh output is a failure, not a crash", () => {
  assert.deepEqual(
    resolveAll(["PRRT_1"], { run: graphqlRun({ stdout: "<html>502</html>" }) })
      .failed,
    ["PRRT_1"]
  );
});

// The node ID goes through `-F` rather than being interpolated into the query
// text, so it is never parsed as GraphQL syntax.
test("the thread id is passed as a GraphQL variable, not spliced into the query", () => {
  const run = graphqlRun({ isResolved: true });
  resolveAll(["PRRT_1"], { run });
  const argv = run.calls[0];
  assert.ok(argv.includes("-F"));
  assert.ok(argv.includes("threadId=PRRT_1"));
  const query = argv.find((a) => a.startsWith("query=query"));
  assert.ok(!query.includes("PRRT_1"), "the id is absent from the query text");
});

test("several threads are sorted into the three buckets in one pass", () => {
  const run = (command, args) => {
    const line = args.join(" ");
    const id = line.match(/threadId=(\S+)/)[1];
    const isMutation = line.includes("mutation");
    if (id === "done") {
      return {
        code: 0,
        stderr: "",
        stdout: JSON.stringify({ data: { node: { isResolved: true } } }),
      };
    }
    return {
      code: 0,
      stderr: "",
      stdout: JSON.stringify(
        isMutation
          ? {
              data: {
                resolveReviewThread: { thread: { isResolved: id === "ok" } },
              },
            }
          : { data: { node: { isResolved: false } } }
      ),
    };
  };
  assert.deepEqual(resolveAll(["ok", "done", "bad"], { run }), {
    resolved: ["ok"],
    already_resolved: ["done"],
    failed: ["bad"],
  });
});

test("main exits 1 when any thread failed, and 0 otherwise", () => {
  assert.equal(
    main({
      argv: ["PRRT_1"],
      run: graphqlRun({ isResolved: false, resolveTo: true }),
    }).code,
    0
  );
  assert.equal(
    main({
      argv: ["PRRT_1"],
      run: graphqlRun({ isResolved: false, resolveTo: false }),
    }).code,
    1
  );
});

test("main refuses to run with no thread ids", () => {
  const errors = [];
  const originalError = console.error;
  console.error = (message) => errors.push(message);
  try {
    const { output, code } = main({
      argv: [],
      run: graphqlRun({ isResolved: true }),
    });
    assert.equal(code, 2);
    assert.equal(output, null);
    assert.match(errors[0], /at least one THREAD_ID/);
  } finally {
    console.error = originalError;
  }
});
