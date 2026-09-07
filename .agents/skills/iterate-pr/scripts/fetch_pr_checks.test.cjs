// SPDX-License-Identifier: MIT
"use strict";

/** Tests for fetch_pr_checks.cjs. No process is spawned. */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LOG_FETCH_TIMEOUT_MS,
  decorateChecks,
  extractFailureSnippet,
  main,
  parseChecks,
  summarize,
} = require("./fetch_pr_checks.cjs");

test("parseChecks reads gh's tab-separated rows", () => {
  const stdout = [
    "Validate\tpass\t1m20s\thttps://example/1",
    "Changeset\tfail\t12s\thttps://example/2",
  ].join("\n");
  assert.deepEqual(parseChecks(stdout), [
    {
      name: "Validate",
      bucket: "pass",
      link: "https://example/1",
      workflow: "",
    },
    {
      name: "Changeset",
      bucket: "fail",
      link: "https://example/2",
      workflow: "",
    },
  ]);
});

test("parseChecks tolerates blank lines, short rows, and a missing link", () => {
  const stdout = "\nValidate\tpass\n\nnoise-with-no-tab\n";
  assert.deepEqual(parseChecks(stdout), [
    { name: "Validate", bucket: "pass", link: "", workflow: "" },
  ]);
  assert.deepEqual(parseChecks("   "), []);
});

// The first marker, not the tail: a job that fails early and then prints a long
// teardown would otherwise report only the teardown.
test("extractFailureSnippet anchors on the first failure marker", () => {
  const lines = [
    ...Array.from({ length: 20 }, (_, index) => `setup ${index}`),
    "Error: boom",
    "  at thing",
    ...Array.from({ length: 80 }, (_, index) => `teardown ${index}`),
  ];
  const snippet = extractFailureSnippet(lines.join("\n"));
  assert.match(snippet, /Error: boom/);
  assert.match(snippet, /setup 15/, "keeps five lines of leading context");
  assert.doesNotMatch(snippet, /setup 14/);
  assert.doesNotMatch(
    snippet,
    /teardown 79/,
    "does not run to the end of the log"
  );
});

test("extractFailureSnippet falls back to the tail when nothing matches", () => {
  const log = Array.from({ length: 80 }, (_, index) => `line ${index}`).join(
    "\n"
  );
  const snippet = extractFailureSnippet(log, 10);
  assert.equal(snippet.split("\n").length, 10);
  assert.match(snippet, /line 79/);
});

test("extractFailureSnippet says how many further errors it cut off", () => {
  const log = [
    "Error: first",
    ...Array.from({ length: 60 }, (_, index) => `noise ${index}`),
    "Error: second",
    "Error: third",
  ].join("\n");
  assert.match(extractFailureSnippet(log), /\(2 more error\(s\) follow\)/);
});

test("summarize counts each bucket, with skipping and cancel both skipped", () => {
  assert.deepEqual(
    summarize([
      { status: "pass" },
      { status: "pass" },
      { status: "fail" },
      { status: "pending" },
      { status: "skipping" },
      { status: "cancel" },
    ]),
    { total: 6, passed: 2, failed: 1, pending: 1, skipped: 2 }
  );
});

/** A `run` driven by a table of [command-prefix, result] pairs. */
const scriptedRun = (table) => {
  const calls = [];
  return Object.assign(
    (command, args) => {
      const line = [command, ...args].join(" ");
      calls.push(line);
      for (const [prefix, result] of table) {
        if (line.includes(prefix)) {
          return { code: 0, stdout: "", stderr: "", ...result };
        }
      }
      return { code: 1, stdout: "", stderr: `unstubbed: ${line}` };
    },
    { calls }
  );
};

test("decorateChecks attaches a log snippet to a failing check", () => {
  const run = scriptedRun([
    [
      "run list",
      {
        stdout: JSON.stringify([
          { databaseId: 42, name: "Validate", conclusion: "failure" },
          { databaseId: 43, name: "Other", conclusion: "success" },
        ]),
      },
    ],
    ["run view 42", { stdout: "prelude\nError: nope\n" }],
  ]);

  const decorated = decorateChecks(
    [
      { name: "Validate", bucket: "fail" },
      { name: "Changeset", bucket: "pass" },
    ],
    "some-branch",
    { run, log: () => {} }
  );

  assert.equal(decorated[0].run_id, 42);
  assert.match(decorated[0].log_snippet, /Error: nope/);
  assert.equal(decorated[1].status, "pass");
  assert.ok(!("log_snippet" in decorated[1]), "a passing check gets no logs");
});

// The run list is the expensive call and its result does not change between
// checks, so it is fetched at most once no matter how many checks failed.
test("decorateChecks lists failed runs once for many failures", () => {
  const run = scriptedRun([["run list", { stdout: "[]" }]]);
  decorateChecks(
    [
      { name: "A", bucket: "fail" },
      { name: "B", bucket: "fail" },
      { name: "C", bucket: "fail" },
    ],
    "branch",
    { run, log: () => {} }
  );
  assert.equal(run.calls.filter((c) => c.includes("run list")).length, 1);
});

test("main reports an error and exits 1 when there is no PR", () => {
  const run = scriptedRun([
    ["pr view", { code: 1, stderr: "no pull requests found" }],
  ]);
  const { output, code } = main({ argv: [], run, log: () => {} });
  assert.equal(code, 1);
  assert.deepEqual(output, { error: "No PR found for current branch" });
});

test("main assembles pr, summary, and checks for --pr", () => {
  const run = scriptedRun([
    [
      "pr view 295",
      {
        stdout: JSON.stringify({
          number: 295,
          url: "https://example/295",
          headRefName: "topic",
          baseRefName: "main",
        }),
      },
    ],
    ["pr checks 295", { stdout: "Validate\tpass\t1s\thttps://example/1" }],
  ]);
  const { output, code } = main({ argv: ["--pr", "295"], run });
  assert.equal(code, 0);
  assert.deepEqual(output.pr, {
    number: 295,
    url: "https://example/295",
    branch: "topic",
    base: "main",
  });
  assert.deepEqual(output.summary, {
    total: 1,
    passed: 1,
    failed: 0,
    pending: 0,
    skipped: 0,
  });
});

// The Python original passed `timeout=60` and returned None on TimeoutExpired.
// This script is what the skill's polling loop calls every iteration, so a
// `gh run view --log-failed` that hangs freezes the whole automation.
test("the log fetch is bounded by a timeout", () => {
  const calls = [];
  const run = (command, args, options) => {
    calls.push(options);
    return { code: 0, stdout: "[]", stderr: "", timedOut: false };
  };
  decorateChecks([{ name: "A", bucket: "fail" }], "branch", {
    run,
    log: () => {},
  });
  // The run-list call is unbounded; only the log fetch carries a deadline, and
  // it is reached only when a matching failed run exists.
  const runLogsCall = calls.find((options) => options?.timeoutMs !== undefined);
  assert.equal(runLogsCall, undefined, "no matching run, so no log fetch");

  const withRun = [];
  decorateChecks([{ name: "Validate", bucket: "fail" }], "branch", {
    log: () => {},
    run: (command, args, options) => {
      const line = [command, ...args].join(" ");
      withRun.push({ line, options });
      if (line.includes("run list")) {
        return {
          code: 0,
          stderr: "",
          timedOut: false,
          stdout: JSON.stringify([
            { databaseId: 1, name: "Validate", conclusion: "failure" },
          ]),
        };
      }
      return { code: 0, stdout: "log", stderr: "", timedOut: false };
    },
  });
  const logCall = withRun.find((c) => c.line.includes("run view"));
  assert.equal(logCall.options.timeoutMs, LOG_FETCH_TIMEOUT_MS);
});

test("a timed-out log fetch yields no snippet rather than the timeout text", () => {
  const decorated = decorateChecks(
    [{ name: "Validate", bucket: "fail" }],
    "b",
    {
      log: () => {},
      run: (command, args) => {
        const line = [command, ...args].join(" ");
        if (line.includes("run list")) {
          return {
            code: 0,
            stderr: "",
            timedOut: false,
            stdout: JSON.stringify([
              { databaseId: 1, name: "Validate", conclusion: "failure" },
            ]),
          };
        }
        return { code: -1, stdout: "", stderr: "ETIMEDOUT", timedOut: true };
      },
    }
  );
  assert.ok(!("log_snippet" in decorated[0]));
  assert.ok(!("run_id" in decorated[0]));
});

// `--pr abc` used to become NaN, reach gh as the literal "NaN", and come back
// as "No PR found for current branch" — a misleading message for someone who
// did name a PR.
test("a malformed --pr is rejected instead of reported as a missing PR", () => {
  assert.throws(
    () => main({ argv: ["--pr", "abc"], run: () => {}, log: () => {} }),
    /--pr expects an integer/
  );
});
