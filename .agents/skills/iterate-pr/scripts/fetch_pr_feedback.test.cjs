// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for fetch_pr_feedback.cjs — the LOGAF bucketing, the bot split, the
 * self-review handling, and the 🎉 acknowledgement scoping.
 *
 * `buildFeedback` takes its gh client as an argument, so the whole assembly is
 * exercised here from fixtures, with no network and no repository.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFeedback,
  categorizeComment,
  createClient,
  detectLogaf,
  extractFeedbackItem,
  isInfoBot,
  isReviewBot,
} = require("./fetch_pr_feedback.cjs");

test("detectLogaf reads every accepted marker spelling", () => {
  for (const body of [
    "h: must fix",
    "[h] must fix",
    "high: must fix",
    "H: shout",
  ]) {
    assert.equal(detectLogaf(body), "high", body);
  }
  for (const body of ["m: should fix", "[m] should", "medium: should"]) {
    assert.equal(detectLogaf(body), "medium", body);
  }
  for (const body of [
    "l: optional",
    "[l] optional",
    "low: optional",
    "  l: indented",
  ]) {
    assert.equal(detectLogaf(body), "low", body);
  }
  assert.equal(detectLogaf("just a comment"), null);
});

// The marker only counts at the start. A body that merely mentions "high:"
// mid-sentence is ordinary prose, and promoting it would let any discussion of
// priorities re-rank itself.
test("detectLogaf ignores a marker that is not at the start", () => {
  assert.equal(detectLogaf("I would rank this high: but it can wait"), null);
});

test("review bots are recognised and are not info bots", () => {
  for (const name of [
    "claude",
    "sentry-io",
    "cursor[bot]",
    "copilot-pull-request-reviewer",
  ]) {
    assert.ok(isReviewBot(name), name);
  }
  assert.ok(!isReviewBot("some-human"));
});

test("info bots are recognised, including the generic bot suffixes", () => {
  for (const name of [
    "codecov",
    "dependabot[bot]",
    "renovate",
    "whatever-bot",
  ]) {
    assert.ok(isInfoBot(name), name);
  }
  assert.ok(!isInfoBot("some-human"));
});

// `claude[bot]` matches BOTH lists — the review-bot patterns by prefix and the
// info-bot patterns by the `[bot]` suffix. Review wins, or the whole point of
// the split is lost: the bot that posts actionable findings would be filed as
// an informational status report and skipped silently.
test("a review bot whose name also ends in [bot] is still a review bot", () => {
  assert.ok(isReviewBot("claude[bot]") && isInfoBot("claude[bot]"));
  assert.equal(
    categorizeComment(
      { user: { login: "claude[bot]" } },
      "This will break at runtime"
    ),
    "high"
  );
  assert.equal(
    categorizeComment(
      { user: { login: "codecov[bot]" } },
      "Coverage dropped 2%"
    ),
    "bot"
  );
});

test("categorizeComment prefers an explicit LOGAF marker over content", () => {
  const human = { user: { login: "reviewer" } };
  // "critical" alone would be high; the marker overrides it.
  assert.equal(
    categorizeComment(human, "l: critical path could be simpler"),
    "low"
  );
  assert.equal(categorizeComment(human, "h: nit about naming"), "high");
});

test("categorizeComment falls back to content, then to medium", () => {
  const human = { user: { login: "reviewer" } };
  assert.equal(
    categorizeComment(human, "This is a security vulnerability"),
    "high"
  );
  assert.equal(categorizeComment(human, "You must fix the lease SHA"), "high");
  assert.equal(categorizeComment(human, "nit: trailing whitespace"), "low");
  assert.equal(categorizeComment(human, "Consider extracting this"), "low");
  assert.equal(
    categorizeComment(human, "Why is the upstream computed here?"),
    "medium"
  );
});

test("extractFeedbackItem truncates the summary but keeps the full body", () => {
  const body = `${"x".repeat(250)}\nsecond line`;
  const item = extractFeedbackItem({ body, author: "a" });
  assert.equal(item.body.length, 203, "200 chars plus the ellipsis");
  assert.equal(item.full_body, body);
  assert.ok(
    !item.body.includes("\n"),
    "newlines are flattened for the summary"
  );
});

test("extractFeedbackItem omits every flag that is not set", () => {
  const item = extractFeedbackItem({ body: "hello", author: "a" });
  assert.deepEqual(Object.keys(item), ["author", "body", "full_body"]);
});

// comment_id 0 is a legitimate id as far as this code is concerned, and a
// falsy check would drop it — leaving the caller with no reaction target and no
// way to mark the comment handled.
test("extractFeedbackItem keeps a zero comment_id", () => {
  assert.equal(
    extractFeedbackItem({ body: "x", author: "a", commentId: 0 }).comment_id,
    0
  );
});

/** A gh client fake: every method answers from the fixture it is given. */
const fakeClient = ({
  threads = [],
  comments = [],
  reviewers = [],
  acknowledged = () => false,
} = {}) => ({
  reviewThreads: () => threads,
  issueComments: () => comments,
  requestedReviewers: () => reviewers,
  hasOurAcknowledgement: (_owner, _repo, id, count) => acknowledged(id, count),
});

const thread = (overrides) => ({
  id: "PRRT_1",
  isResolved: false,
  isOutdated: false,
  path: "src/a.ts",
  line: 12,
  comments: { nodes: [{ body: "body", author: { login: "reviewer" } }] },
  ...overrides,
});

const build = (client, prInfo) =>
  buildFeedback(client, {
    owner: "o",
    repo: "r",
    prInfo: { number: 1, author: { login: "me" }, ...prInfo },
  });

test("a reviewer's CHANGES_REQUESTED summary is always high", () => {
  const output = build(fakeClient(), {
    reviews: [
      {
        author: { login: "reviewer" },
        state: "CHANGES_REQUESTED",
        body: "Please rework the guard.",
      },
    ],
  });
  assert.equal(output.summary.high, 1);
  assert.equal(output.feedback.high[0].type, "changes_requested");
});

// You can't "Request changes" on your own PR, so a self-review arrives as
// COMMENTED summaries and ordinary threads. Dropping them would silently lose
// the author's own notes to themselves, which is most of what a self-review is.
test("a self-review summary is surfaced, flagged, and bucketed by content", () => {
  const output = build(fakeClient(), {
    reviews: [
      {
        author: { login: "me" },
        state: "COMMENTED",
        body: "Still need to handle the empty case.",
      },
    ],
  });
  assert.equal(output.summary.medium, 1);
  assert.equal(output.summary.self_review_feedback, 1);
  assert.equal(output.feedback.medium[0].self_review, true);
});

test("a self-review marked CHANGES_REQUESTED is not force-promoted to high", () => {
  const output = build(fakeClient(), {
    reviews: [
      {
        author: { login: "me" },
        state: "CHANGES_REQUESTED",
        body: "nit: rename this",
      },
    ],
  });
  assert.equal(output.summary.high, 0);
  assert.equal(output.summary.low, 1);
});

test("empty and near-empty review summaries are skipped", () => {
  const output = build(fakeClient(), {
    reviews: [
      { author: { login: "reviewer" }, state: "APPROVED", body: "" },
      { author: { login: "reviewer" }, state: "COMMENTED", body: "ok" },
    ],
  });
  assert.equal(output.summary.needs_attention, 0);
});

test("a resolved thread goes to resolved regardless of its content", () => {
  const output = build(
    fakeClient({
      threads: [
        thread({
          isResolved: true,
          comments: {
            nodes: [{ body: "This is broken", author: { login: "reviewer" } }],
          },
        }),
      ],
    }),
    {}
  );
  assert.equal(output.summary.resolved, 1);
  assert.equal(output.summary.high, 0);
});

test("an unresolved thread carries its thread_id, path, and line for the reply", () => {
  const output = build(fakeClient({ threads: [thread({})] }), {});
  const item = output.feedback.medium[0];
  assert.equal(item.thread_id, "PRRT_1");
  assert.equal(item.path, "src/a.ts");
  assert.equal(item.line, 12);
});

test("a review bot's thread is bucketed by content and flagged, not filed as bot", () => {
  const output = build(
    fakeClient({
      threads: [
        thread({
          comments: {
            nodes: [
              {
                body: "This will break for empty input",
                author: { login: "claude[bot]" },
              },
            ],
          },
        }),
      ],
    }),
    {}
  );
  assert.equal(output.summary.high, 1);
  assert.equal(output.summary.bot_comments, 0);
  assert.equal(output.summary.review_bot_feedback, 1);
});

test("threads with no comments, or a near-empty first comment, are skipped", () => {
  const output = build(
    fakeClient({
      threads: [
        thread({ comments: { nodes: [] } }),
        thread({
          id: "PRRT_2",
          comments: { nodes: [{ body: "ok", author: { login: "reviewer" } }] },
        }),
      ],
    }),
    {}
  );
  assert.equal(output.summary.needs_attention, 0);
});

test("the PR author's own top-level comments are skipped", () => {
  const output = build(
    fakeClient({
      comments: [{ id: 1, body: "Rebased onto main.", user: { login: "me" } }],
    }),
    {}
  );
  assert.equal(output.summary.needs_attention, 0);
});

// The 🎉 marker is what stops a re-run re-reporting a comment that was already
// answered; without it every later pass surfaces the same finding again.
test("an acknowledged top-level comment moves to resolved", () => {
  const output = build(
    fakeClient({
      comments: [
        {
          id: 99,
          body: "This will break the lease check",
          user: { login: "claude[bot]" },
          reactions: { hooray: 1 },
          html_url: "https://example/99",
        },
      ],
      acknowledged: (id) => id === 99,
    }),
    {}
  );
  assert.equal(output.summary.resolved, 1);
  assert.equal(output.summary.high, 0);
  assert.equal(output.feedback.resolved[0].acknowledged, true);
  assert.equal(output.feedback.resolved[0].comment_id, 99);
});

test("an unacknowledged top-level comment stays in its priority bucket", () => {
  const output = build(
    fakeClient({
      comments: [
        {
          id: 99,
          body: "This will break the lease check",
          user: { login: "claude[bot]" },
          reactions: { hooray: 0 },
        },
      ],
    }),
    {}
  );
  assert.equal(output.summary.high, 1);
  assert.equal(output.summary.resolved, 0);
});

test("pending reviewers are counted, and action_required tracks the top bucket", () => {
  const withNothing = build(fakeClient(), {});
  assert.equal(withNothing.action_required, null);
  assert.equal(withNothing.summary.pending_reviewers, 0);

  const withLow = build(
    fakeClient({
      threads: [
        thread({
          comments: {
            nodes: [{ body: "nit: spacing", author: { login: "reviewer" } }],
          },
        }),
      ],
      reviewers: ["someone", "@org/team"],
    }),
    {}
  );
  assert.match(withLow.action_required, /low-priority/);
  assert.equal(withLow.summary.pending_reviewers, 2);

  const withHigh = build(
    fakeClient({
      threads: [
        thread({
          comments: {
            nodes: [{ body: "h: fix", author: { login: "reviewer" } }],
          },
        }),
      ],
    }),
    {}
  );
  assert.match(withHigh.action_required, /high-priority/);
});

/** A `run` that answers gh calls from a table of [substring, result]. */
const scriptedRun = (table) => (command, args) => {
  const line = [command, ...args].join(" ");
  for (const [needle, result] of table) {
    if (line.includes(needle))
      return { code: 0, stdout: "", stderr: "", ...result };
  }
  return { code: 1, stdout: "", stderr: `unstubbed: ${line}` };
};

// The reaction count on the payload is EVERY user's. A maintainer celebrating a
// review would otherwise mark the finding handled and silently drop it, so the
// reaction has to be attributed before it counts.
test("hasOurAcknowledgement ignores someone else's 🎉", () => {
  const client = createClient({
    run: scriptedRun([
      ["api user", { stdout: JSON.stringify({ login: "me" }) }],
      [
        "reactions",
        {
          stdout: JSON.stringify([
            { content: "hooray", user: { login: "someone-else" } },
          ]),
        },
      ],
    ]),
    log: () => {},
  });
  assert.equal(client.hasOurAcknowledgement("o", "r", 1, 1), false);
});

test("hasOurAcknowledgement accepts our own 🎉 and only 🎉", () => {
  const mine = (content) =>
    createClient({
      run: scriptedRun([
        ["api user", { stdout: JSON.stringify({ login: "me" }) }],
        [
          "reactions",
          { stdout: JSON.stringify([{ content, user: { login: "me" } }]) },
        ],
      ]),
      log: () => {},
    });
  assert.equal(mine("hooray").hasOurAcknowledgement("o", "r", 1, 1), true);
  assert.equal(mine("heart").hasOurAcknowledgement("o", "r", 1, 1), false);
});

// Fails closed in both directions: an unidentifiable viewer and a failed lookup
// both leave the item unacknowledged, so it resurfaces. Answering twice beats
// dropping feedback.
test("hasOurAcknowledgement fails closed when the viewer cannot be identified", () => {
  const client = createClient({
    run: scriptedRun([
      [
        "reactions",
        {
          stdout: JSON.stringify([
            { content: "hooray", user: { login: "me" } },
          ]),
        },
      ],
    ]),
    log: () => {},
  });
  assert.equal(client.hasOurAcknowledgement("o", "r", 1, 1), false);
});

test("hasOurAcknowledgement skips the lookup entirely when the count is zero", () => {
  let called = false;
  const client = createClient({
    run: (command, args) => {
      if ([command, ...args].join(" ").includes("reactions")) called = true;
      return { code: 0, stdout: "[]", stderr: "" };
    },
    log: () => {},
  });
  assert.equal(client.hasOurAcknowledgement("o", "r", 1, 0), false);
  assert.equal(called, false);
});

test("requestedReviewers includes teams, which are the ones easily missed", () => {
  const client = createClient({
    run: scriptedRun([
      [
        "api repos/o/r/pulls/1",
        {
          stdout: JSON.stringify({
            requested_reviewers: [{ login: "alice" }],
            requested_teams: [{ slug: "cli-team" }],
          }),
        },
      ],
    ]),
    log: () => {},
  });
  assert.deepEqual(client.requestedReviewers("o", "r", 1), [
    "alice",
    "@cli-team",
  ]);
});

test("viewerLogin is looked up once and cached", () => {
  let calls = 0;
  const client = createClient({
    run: () => {
      calls += 1;
      return { code: 0, stdout: JSON.stringify({ login: "me" }), stderr: "" };
    },
    log: () => {},
  });
  assert.equal(client.viewerLogin(), "me");
  assert.equal(client.viewerLogin(), "me");
  assert.equal(calls, 1);
});
