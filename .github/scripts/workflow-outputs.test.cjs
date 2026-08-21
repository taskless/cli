// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for workflow-outputs.cjs — the guard on single-quoted step outputs.
 *
 * Most cases run the checker over an inline workflow fragment. The last one
 * runs it over the committed workflows, which is the point of the check: it is
 * the repository's own `focus=` strings it exists to protect.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  checkWorkflowSource,
  checkWorkflows,
} = require("./workflow-outputs.cjs");

const wrap = (...lines) =>
  [
    "jobs:",
    "  a:",
    "    steps:",
    "      - run: |",
    ...lines.map((l) => `          ${l}`),
  ].join("\n");

test("accepts a correctly quoted output", () => {
  const errors = checkWorkflowSource(
    wrap("echo 'mode=full' >> \"$GITHUB_OUTPUT\""),
    "w.yml"
  );
  assert.deepEqual(errors, []);
});

test("accepts a value containing backticks and dollars", () => {
  // The reason these are single-quoted in the first place.
  const errors = checkWorkflowSource(
    wrap(
      "echo 'focus=Run `gh pr diff` and read $HOME first.' >> \"$GITHUB_OUTPUT\""
    ),
    "w.yml"
  );
  assert.deepEqual(errors, []);
});

test("rejects an apostrophe inside the value", () => {
  // The failure this guard exists for: the quote closes at "don" and the rest
  // of the line becomes shell words.
  const errors = checkWorkflowSource(
    wrap(
      "echo 'focus=Review this PR, but don't run the tests.' >> \"$GITHUB_OUTPUT\""
    ),
    "w.yml"
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unterminated single-quoted string/);
  assert.match(errors[0], /w\.yml:5/);
});

test("rejects a value wrapped onto a second line", () => {
  // $GITHUB_OUTPUT is line-oriented; a multi-line value needs heredoc syntax.
  // The redirect ends up on the FOLLOWING line, so a check keyed off
  // `$GITHUB_OUTPUT` would never look at the line that is actually broken.
  const errors = checkWorkflowSource(
    wrap("echo 'focus=First half", 'second half\' >> "$GITHUB_OUTPUT"'),
    "w.yml"
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unterminated single-quoted string/);
  assert.match(errors[0], /w\.yml:5/);
});

test("rejects trailing content after the redirect", () => {
  const errors = checkWorkflowSource(
    wrap("echo 'mode=full' >> \"$GITHUB_OUTPUT\" && echo done"),
    "w.yml"
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /malformed step output/);
});

test("ignores double-quoted echoes, which may legitimately hold apostrophes", () => {
  const errors = checkWorkflowSource(
    wrap('echo "pr=${{ github.event.issue.number }}" >> "$GITHUB_OUTPUT"'),
    "w.yml"
  );
  assert.deepEqual(errors, []);
});

test("ignores a single-quoted echo that is not a step output", () => {
  const errors = checkWorkflowSource(wrap("echo 'threads: none'"), "w.yml");
  assert.deepEqual(errors, []);
});

test("accepts a comparison against a value the file writes", () => {
  const source = [
    wrap(
      "echo 'mode=full' >> \"$GITHUB_OUTPUT\"",
      "echo 'mode=incremental' >> \"$GITHUB_OUTPUT\""
    ),
    "      - if: steps.prep.outputs.mode != 'full'",
  ].join("\n");
  assert.deepEqual(checkWorkflowSource(source, "w.yml"), []);
});

test("rejects a comparison against a value nothing writes", () => {
  // The drift case: the gate was left behind when the written value changed.
  const source = [
    wrap(
      "echo 'mode=full-review' >> \"$GITHUB_OUTPUT\"",
      "echo 'mode=incremental' >> \"$GITHUB_OUTPUT\""
    ),
    "      - if: steps.prep.outputs.mode != 'full'",
  ].join("\n");
  const errors = checkWorkflowSource(source, "w.yml");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /compares steps output 'mode' against 'full'/);
  assert.match(errors[0], /Written: full-review, incremental/);
});

test("skips a comparison for a key the file never writes", () => {
  // An action's own output — no ground truth here, so no opinion.
  const source = "      - if: steps.detect.outputs.needed == 'true'\n";
  assert.deepEqual(checkWorkflowSource(source, "w.yml"), []);
});

test("the committed workflows pass", () => {
  const { errors, checked } = checkWorkflows(".github/workflows");
  assert.deepEqual(errors, []);
  assert.ok(checked > 0, "expected to find workflow files");
});
