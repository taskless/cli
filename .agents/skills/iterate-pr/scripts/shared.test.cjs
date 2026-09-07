// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for shared.cjs.
 *
 * Nothing here spawns a process: every function that touches the outside world
 * takes its runner as an argument, and the fakes below stand in for `gh` and
 * `git`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FatalError,
  UsageError,
  countRange,
  gitOut,
  lineage,
  orderedDescendants,
  parseIntegerOption,
  prView,
  refExists,
  runGh,
  runProcess,
} = require("./shared.cjs");

/** A `run` that returns one canned result and records what it was asked. */
const stubRun = (result) => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    return { code: 0, stdout: "", stderr: "", ...result };
  };
  run.calls = calls;
  return run;
};

test("runGh parses JSON stdout", () => {
  const run = stubRun({ stdout: '{"number": 7}' });
  assert.deepEqual(runGh(["pr", "view"], { run, log: () => {} }), {
    number: 7,
  });
  assert.deepEqual(run.calls[0], ["gh", "pr", "view"]);
});

test("runGh returns null on a non-zero exit and reports gh's own stderr", () => {
  const logged = [];
  const run = stubRun({ code: 1, stderr: "gh: not authenticated" });
  assert.equal(
    runGh(["pr", "view"], { run, log: (m) => logged.push(m) }),
    null
  );
  assert.match(logged[0], /not authenticated/);
});

test("runGh returns null for empty and for unparseable output", () => {
  const quiet = { log: () => {} };
  assert.equal(
    runGh(["x"], { run: stubRun({ stdout: "   " }), ...quiet }),
    null
  );
  assert.equal(
    runGh(["x"], { run: stubRun({ stdout: "not json" }), ...quiet }),
    null
  );
});

test("lineage maps head -> base for every open PR", () => {
  const run = stubRun({
    stdout: JSON.stringify([
      { headRefName: "child", baseRefName: "parent" },
      { headRefName: "parent", baseRefName: "main" },
    ]),
  });
  assert.deepEqual(lineage({ run }), { child: "parent", parent: "main" });
});

test("lineage skips PRs missing either end of the edge", () => {
  const run = stubRun({
    stdout: JSON.stringify([
      { headRefName: "child", baseRefName: "" },
      { baseRefName: "main" },
      { headRefName: "ok", baseRefName: "main" },
    ]),
  });
  assert.deepEqual(lineage({ run }), { ok: "main" });
});

// A gh failure must NOT read as an empty stack. An empty map masquerades as
// "no descendants", which lets a propagation run exit 0 having silently skipped
// every branch it was asked to carry a fix to.
test("lineage throws rather than reporting an empty stack when gh fails", () => {
  const run = stubRun({ code: 1, stderr: "HTTP 401" });
  assert.throws(
    () => lineage({ run }),
    (error) => {
      assert.ok(error instanceof FatalError);
      assert.match(error.message, /gh pr list` failed/);
      assert.match(error.message, /HTTP 401/);
      return true;
    }
  );
});

test("lineage throws on unparseable gh output", () => {
  const run = stubRun({ stdout: "<html>" });
  assert.throws(() => lineage({ run }), FatalError);
});

test("orderedDescendants lists every descendant parent-before-child", () => {
  const edges = { a: "root", b: "a", c: "b", other: "main" };
  const ordered = orderedDescendants("root", edges);
  assert.deepEqual(ordered, ["a", "b", "c"]);
  assert.ok(ordered.indexOf("a") < ordered.indexOf("b"));
  assert.ok(ordered.indexOf("b") < ordered.indexOf("c"));
});

// GitHub permits a base cycle (A based on B while B is based on A). This is the
// walk that drives rebases and force-pushes, so spinning here is not a hang, it
// is an unbounded sequence of force-pushes.
test("orderedDescendants terminates on a base cycle", () => {
  const ordered = orderedDescendants("root", {
    a: "root",
    b: "a",
    a2: "b",
    a3: "a2",
  });
  assert.deepEqual(ordered, ["a", "b", "a2", "a3"]);
  assert.deepEqual(orderedDescendants("a", { a: "b", b: "a" }), ["b"]);
});

test("orderedDescendants returns nothing for a leaf", () => {
  assert.deepEqual(orderedDescendants("tip", { tip: "main" }), []);
});

test("countRange reads a commit count and reports -1 when git cannot answer", () => {
  assert.equal(
    countRange(() => ({ code: 0, stdout: "3\n", stderr: "" }), "a..b"),
    3
  );
  assert.equal(
    countRange(() => ({ code: 1, stdout: "", stderr: "" }), "a..b"),
    -1
  );
  assert.equal(
    countRange(() => ({ code: 0, stdout: "fatal: bad", stderr: "" }), "a..b"),
    -1
  );
});

test("refExists follows git's exit code", () => {
  assert.equal(
    refExists(() => ({ code: 0, stdout: "", stderr: "" }), "main"),
    true
  );
  assert.equal(
    refExists(() => ({ code: 1, stdout: "", stderr: "" }), "nope"),
    false
  );
});

test("gitOut strips stdout and yields empty string on failure", () => {
  assert.equal(
    gitOut(() => ({ code: 0, stdout: " abc \n", stderr: "" })),
    "abc"
  );
  assert.equal(
    gitOut(() => ({ code: 1, stdout: "abc", stderr: "" })),
    ""
  );
});

// NO SHELL IS INVOLVED, ANYWHERE. Every external command in these scripts goes
// through this one `spawnSync(command, args)`, which is passed no `shell`
// option — so arguments are never word-split, glob-expanded, or re-parsed for
// metacharacters. That is what makes a branch name containing `*`, a space, or
// a `;` safe to pass straight through, and it is why nothing here shells out to
// `sed`, `xargs`, or a pipeline: a command runs, its output is parsed in Node,
// and the next command is invoked with an argv array.
//
// This is asserted behaviourally rather than by scanning the source for
// `shell: true` — the argument below only survives intact if no shell saw it.
test("runProcess passes arguments through literally, with no shell", () => {
  const hostile = "a b*c; echo pwned && touch /tmp/nope";
  const result = runProcess(process.execPath, [
    "-e",
    "process.stdout.write(String(process.argv[1]))",
    hostile,
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, hostile);
});

test("runProcess reports a missing executable instead of throwing", () => {
  const result = runProcess("definitely-not-a-real-command-xyz", []);
  assert.equal(result.code, -1);
  assert.match(result.stderr, /ENOENT|not.*found/i);
});

test("parseIntegerOption accepts integers and passes through an absent value", () => {
  assert.equal(parseIntegerOption("pr", "299"), 299);
  assert.equal(parseIntegerOption("max-own", "-3"), -3);
  assert.equal(parseIntegerOption("pr", " 7 "), 7);
  assert.equal(parseIntegerOption("pr", undefined), undefined);
});

// `Number("abc")` is NaN, which is the dangerous wrong answer rather than the
// obvious one: it flows onward, every comparison against it is false, and a
// guard written as `actual > limit` silently never fires. Rejecting up front is
// what Python's argparse(type=int) did.
test("parseIntegerOption rejects a malformed value instead of yielding NaN", () => {
  for (const bad of ["abc", "", "3.5", "12x", "--"]) {
    assert.throws(
      () => parseIntegerOption("pr", bad),
      UsageError,
      `expected --pr ${JSON.stringify(bad)} to be rejected`
    );
  }
});

// The number goes BEFORE `--json`: `gh pr view --json x 299` is a different
// command, and getting it wrong is why this is shared rather than written twice.
test("prView puts the PR number ahead of --json, and omits it when absent", () => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    return { code: 0, stdout: "{}", stderr: "" };
  };
  prView("number,url", 299, { run, log: () => {} });
  assert.deepEqual(calls[0], [
    "gh",
    "pr",
    "view",
    "299",
    "--json",
    "number,url",
  ]);
  prView("number,url", undefined, { run, log: () => {} });
  assert.deepEqual(calls[1], ["gh", "pr", "view", "--json", "number,url"]);
});

// A hang is worse than a failure on the polling path: it freezes the iterate
// loop with no way out short of killing the process.
test("runProcess gives up on a hanging command and reports timedOut", () => {
  const result = runProcess(
    process.execPath,
    ["-e", "setTimeout(() => {}, 10_000)"],
    { timeoutMs: 250 }
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.code, -1);
});

test("runProcess reports timedOut false for a command that simply fails", () => {
  const result = runProcess(process.execPath, ["-e", "process.exit(3)"]);
  assert.equal(result.code, 3);
  assert.equal(result.timedOut, false);
});
