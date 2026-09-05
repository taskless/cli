// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for openspec-tracking.cjs.
 *
 * The planner is pure, so every case here is an inline input object. Only the
 * directory scan touches disk, and it builds a throwaway tree in a temp
 * directory rather than reading the committed `openspec/changes/`, which would
 * make these tests pass or fail on whatever work happens to be in flight.
 *
 * Actions carry rendered prose, so most assertions read the fields that decide
 * behaviour and leave the wording to the few cases that check it directly.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  marker,
  changeFromBody,
  listUnarchivedChanges,
  claimsFromPullRequests,
  normalizeIssues,
  issueBody,
  planActions,
  main,
} = require("./openspec-tracking.cjs");

/** The decision-bearing fields of an action, without the rendered prose. */
function shape(action) {
  const { title, body, comment, ...rest } = action;
  return rest;
}

function shapes(plan) {
  return plan.actions.map(shape);
}

test("a marker round-trips through an issue body", () => {
  assert.equal(changeFromBody(issueBody("my-change", "abc123")), "my-change");
  assert.equal(changeFromBody(`prose\n\n${marker("other")}\n`), "other");
});

test("a body with no marker adopts nothing", () => {
  assert.equal(changeFromBody("an unrelated issue"), undefined);
  assert.equal(changeFromBody(undefined), undefined);
});

test("the issue body states the consequence and the command", () => {
  const body = issueBody("some-change", "deadbee");
  assert.match(body, /standing specs are wrong right now/);
  assert.match(body, /pnpm openspec archive some-change/);
  assert.match(body, /MODIFIED Requirements/);
  assert.match(body, /deadbee/);
});

test("the scan lists change directories and skips archive", () => {
  const root = mkdtempSync(join(tmpdir(), "openspec-tracking-"));
  try {
    const changes = join(root, "changes");
    mkdirSync(join(changes, "archive", "2026-01-01-old"), { recursive: true });
    mkdirSync(join(changes, "beta"), { recursive: true });
    mkdirSync(join(changes, "alpha"), { recursive: true });
    writeFileSync(join(changes, "README.md"), "not a directory");
    assert.deepEqual(listUnarchivedChanges(changes), ["alpha", "beta"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing changes directory is not a fault", () => {
  assert.deepEqual(listUnarchivedChanges("/nonexistent/openspec/changes"), []);
});

test("a pull request touching a change directory claims it", () => {
  const claims = claimsFromPullRequests([
    { number: 265, files: ["openspec/changes/thing/tasks.md", "src/a.ts"] },
    { number: 266, files: ["openspec/changes/thing/proposal.md"] },
    { number: 267, files: ["src/b.ts"] },
  ]);
  assert.deepEqual(claims, { thing: [265, 266] });
});

test("touching the archive claims nothing", () => {
  const claims = claimsFromPullRequests([
    { number: 1, files: ["openspec/changes/archive/2026-01-01-old/tasks.md"] },
  ]);
  assert.deepEqual(claims, {});
});

test("a pull request with no files claims nothing", () => {
  assert.deepEqual(claimsFromPullRequests([{ number: 1 }]), {});
});

test("the planner reduces pull requests to claims itself", () => {
  const plan = planActions({
    mode: "push",
    unarchived: [{ name: "in-flight" }],
    pulls: [{ number: 266, files: ["openspec/changes/in-flight/tasks.md"] }],
    issues: [],
  });
  assert.deepEqual(shapes(plan), []);
});

test("an unclaimed change with no issue opens one", () => {
  const plan = planActions({
    mode: "push",
    sha: "abc123",
    unarchived: [{ name: "orphan" }],
    claims: {},
    issues: [],
  });
  assert.deepEqual(shapes(plan), [{ type: "open", change: "orphan" }]);
  assert.equal(plan.actions[0].title, "OpenSpec: orphan is unarchived on main");
  assert.match(plan.actions[0].body, /<!-- openspec-tracking:orphan -->/);
});

test("a draining stack reports nothing", () => {
  const plan = planActions({
    mode: "push",
    unarchived: [{ name: "in-flight" }],
    claims: { "in-flight": [266, 267] },
    issues: [],
  });
  assert.deepEqual(shapes(plan), []);
});

test("a closed issue reopens rather than opening a second", () => {
  const plan = planActions({
    mode: "push",
    unarchived: [{ name: "orphan" }],
    claims: {},
    issues: [{ number: 12, state: "closed", change: "orphan" }],
  });
  assert.deepEqual(shapes(plan), [
    { type: "reopen", change: "orphan", issue: 12 },
  ]);
});

test("an open issue for an unclaimed change is left alone", () => {
  const plan = planActions({
    mode: "push",
    unarchived: [{ name: "orphan" }],
    claims: {},
    issues: [{ number: 12, state: "open", change: "orphan" }],
  });
  assert.deepEqual(shapes(plan), []);
});

test("archiving a change closes its issue", () => {
  const plan = planActions({
    mode: "push",
    sha: "feedbee",
    unarchived: [],
    claims: {},
    issues: [{ number: 12, state: "open", change: "landed" }],
  });
  assert.deepEqual(shapes(plan), [
    { type: "close", reason: "archived", change: "landed", issue: 12 },
  ]);
  assert.match(plan.actions[0].comment, /Archived\./);
  assert.match(plan.actions[0].comment, /feedbee/);
});

test("work resuming on a reported change closes its issue as claimed", () => {
  const plan = planActions({
    mode: "push",
    unarchived: [{ name: "resumed" }],
    claims: { resumed: [300] },
    issues: [{ number: 12, state: "open", change: "resumed" }],
  });
  assert.deepEqual(shapes(plan), [
    {
      type: "close",
      reason: "claimed",
      change: "resumed",
      issue: 12,
      claimants: [300],
    },
  ]);
  assert.match(plan.actions[0].comment, /Claimed again/);
  assert.match(plan.actions[0].comment, /300/);
});

test("a closed issue for an archived change stays closed", () => {
  const plan = planActions({
    mode: "push",
    unarchived: [],
    claims: {},
    issues: [{ number: 12, state: "closed", change: "landed" }],
  });
  assert.deepEqual(shapes(plan), []);
});

test("the sweep escalates only past the window", () => {
  const input = {
    mode: "sweep",
    staleDays: 7,
    claims: {},
    issues: [{ number: 12, state: "open", change: "stalled" }],
  };
  assert.deepEqual(
    shapes(planActions({ ...input, unarchived: [{ name: "stalled", ageDays: 6 }] })),
    []
  );
  assert.deepEqual(
    shapes(planActions({ ...input, unarchived: [{ name: "stalled", ageDays: 7 }] })),
    [{ type: "escalate", change: "stalled", issue: 12, ageDays: 7 }]
  );
});

test("the sweep opens an issue when the push check never ran", () => {
  const plan = planActions({
    mode: "sweep",
    staleDays: 7,
    unarchived: [{ name: "missed", ageDays: 30 }],
    claims: {},
    issues: [],
  });
  assert.deepEqual(shapes(plan), [{ type: "open", change: "missed" }]);
});

test("the sweep ignores claims, because age is read from activity", () => {
  const plan = planActions({
    mode: "sweep",
    staleDays: 7,
    unarchived: [{ name: "stalled", ageDays: 30 }],
    claims: { stalled: [400] },
    issues: [],
  });
  assert.deepEqual(shapes(plan), [{ type: "open", change: "stalled" }]);
});

test("the sweep also closes an issue for an archived change", () => {
  // The sweep backstops the push check never having been evaluated, and that
  // applies to the success path too: a stale open issue against work that was
  // archived is noise.
  const plan = planActions({
    mode: "sweep",
    staleDays: 7,
    unarchived: [],
    claims: {},
    issues: [{ number: 12, state: "open", change: "landed" }],
  });
  assert.deepEqual(shapes(plan), [
    { type: "close", reason: "archived", change: "landed", issue: 12 },
  ]);
});

test("the sweep does not parse task completion", () => {
  // Two changes identical but for their tasks; the planner never sees tasks at
  // all, so both cross the window on age alone.
  const plan = planActions({
    mode: "sweep",
    staleDays: 7,
    unarchived: [
      { name: "finished", ageDays: 10 },
      { name: "half-done", ageDays: 10 },
    ],
    claims: {},
    issues: [],
  });
  assert.deepEqual(shapes(plan), [
    { type: "open", change: "finished" },
    { type: "open", change: "half-done" },
  ]);
});

test("issues are matched from their body, so one regex exists rather than three", () => {
  const plan = planActions({
    mode: "push",
    unarchived: [{ name: "orphan" }],
    claims: {},
    issues: [
      { number: 12, state: "CLOSED", body: `prose\n${marker("orphan")}\n` },
      { number: 13, state: "open", body: "an unrelated issue carrying the label" },
    ],
  });
  assert.deepEqual(shapes(plan), [
    { type: "reopen", change: "orphan", issue: 12 },
  ]);
});

test("an issue with no marker is never adopted and never closed", () => {
  const plan = planActions({
    mode: "push",
    unarchived: [],
    claims: {},
    issues: [{ number: 13, state: "open", body: "someone else's issue" }],
  });
  assert.deepEqual(shapes(plan), []);
});

test("normalizeIssues lowercases state and parses the marker", () => {
  assert.deepEqual(
    normalizeIssues([
      { number: 1, state: "OPEN", body: marker("a"), idleDays: 3 },
      { number: 2, state: "open", body: "no marker" },
      { number: 3, state: "closed", change: "c" },
    ]),
    [
      { number: 1, state: "open", change: "a", idleDays: 3 },
      { number: 3, state: "closed", change: "c", idleDays: undefined },
    ]
  );
});

test("the sweep escalates at most once per window", () => {
  const stalled = { name: "stalled", ageDays: 30 };
  const input = { mode: "sweep", staleDays: 7, unarchived: [stalled], claims: {} };

  // Escalated yesterday: `ageDays` keeps growing, but the issue was just
  // commented on, so a second comment today would be the daily-nag failure.
  assert.deepEqual(
    shapes(
      planActions({
        ...input,
        issues: [{ number: 12, state: "open", change: "stalled", idleDays: 1 }],
      })
    ),
    []
  );

  // Quiet for a full window: escalate again.
  assert.deepEqual(
    shapes(
      planActions({
        ...input,
        issues: [{ number: 12, state: "open", change: "stalled", idleDays: 7 }],
      })
    ),
    [{ type: "escalate", change: "stalled", issue: 12, ageDays: 30 }]
  );
});

test("an unknown mode is a caller defect, not a silent pass", () => {
  assert.throws(() => planActions({ mode: "daily" }), /unknown mode/);
});

test("main parses an input document", () => {
  const plan = main(
    JSON.stringify({
      mode: "push",
      unarchived: [{ name: "orphan" }],
      pulls: [],
      issues: [],
    })
  );
  assert.equal(plan.mode, "push");
  assert.equal(plan.staleDays, 7);
  assert.deepEqual(shapes(plan), [{ type: "open", change: "orphan" }]);
});
