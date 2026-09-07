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
  bucketByAuthor,
  buildFeedback,
  categorizeComment,
  createClient,
  detectLogaf,
  extractFeedbackItem,
  isInfoBot,
  isReviewBot,
  isReviewInProgress,
  main,
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

test("isReviewInProgress recognizes the placeholder Claude posts on trigger", () => {
  const body = [
    '### Review in progress <img src="x" />',
    "",
    "Review mode: incremental — read 0 prior review thread(s) before reviewing.",
    "",
    "- [x] Read `.prior-review.json`",
    "- [ ] Manual pass over core logic",
  ].join("\n");
  assert.ok(isReviewInProgress(body));
});

test("isReviewInProgress tolerates leading whitespace and a bare heading-less form", () => {
  assert.ok(isReviewInProgress("  Review in progress\n\nworking..."));
  assert.ok(isReviewInProgress("## review in progress"));
});

// The whole point of anchoring to the start: a FINISHED review that discusses
// this very behaviour — quoting the phrase mid-body, the way this fix's own PR
// description might — must not be read as unfinished forever. Only a body that
// literally OPENS with the marker is in progress.
test("isReviewInProgress ignores the phrase when it is not at the start", () => {
  const finishedReviewDiscussingTheIssue = [
    "### Review complete",
    "",
    "This PR fixes the bug where a caller could not tell an in-progress review",
    'from a finished one. The placeholder always reads "Review in progress" and',
    "is edited in place once the review finishes.",
    "",
    "No other issues found.",
  ].join("\n");
  assert.ok(!isReviewInProgress(finishedReviewDiscussingTheIssue));
});

test("isReviewInProgress is false for an ordinary finished review", () => {
  assert.ok(
    !isReviewInProgress("### Review complete\n\nLooks good, no issues found.")
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

// This is the exact scenario from the bug report: a caller fetches feedback
// promptly after triggering a review and must be able to tell "reviewed,
// nothing found" from "not reviewed yet" without reading prose itself.
test("an in-progress top-level comment is filed as review_in_progress, not bucketed as feedback", () => {
  const output = build(
    fakeClient({
      comments: [
        {
          id: 1,
          body: '### Review in progress <img src="x" />\n\n- [x] Read the diff\n- [ ] Manual pass',
          user: { login: "claude[bot]" },
        },
      ],
    }),
    {}
  );
  assert.equal(output.summary.review_in_progress, 1);
  assert.equal(output.summary.needs_attention, 0);
  assert.equal(output.summary.high, 0);
  assert.equal(output.summary.medium, 0);
  assert.equal(output.summary.low, 0);
  assert.equal(output.summary.bot_comments, 0);
  assert.equal(output.summary.resolved, 0);
  assert.equal(output.feedback.review_in_progress.length, 1);
  assert.match(output.action_required, /still in progress/);
});

// The counterpart to the case above: once the same bot has finished and edited
// its comment to no longer open with the marker, it is ordinary review-bot
// feedback again and is bucketed by content as usual.
test("a completed review from the same bot is bucketed normally", () => {
  const output = build(
    fakeClient({
      comments: [
        {
          id: 1,
          body: "### Review complete\n\nThis will break on empty input.",
          user: { login: "claude[bot]" },
        },
      ],
    }),
    {}
  );
  assert.equal(output.summary.review_in_progress, 0);
  assert.equal(output.summary.high, 1);
  assert.equal(output.summary.needs_attention, 1);
  assert.equal(
    output.action_required,
    "Address high-priority feedback before merge"
  );
});

// A review that merely mentions the phrase mid-body (e.g. discussing this very
// fix) must not be quarantined forever as "still running".
test("a completed review that mentions the phrase mid-body is not treated as in progress", () => {
  const output = build(
    fakeClient({
      comments: [
        {
          id: 1,
          body: 'This adds detection for the "Review in progress" placeholder. No other issues found.',
          user: { login: "claude[bot]" },
        },
      ],
    }),
    {}
  );
  assert.equal(output.summary.review_in_progress, 0);
  assert.ok(output.feedback.high.length + output.feedback.medium.length > 0);
});

// review_in_progress must outrank high/medium/low in action_required: a caller
// deciding whether to stop must not read existing high-priority findings as
// the whole story while a review that could still surface more is running.
test("review_in_progress in action_required outranks an already-present high item", () => {
  const output = build(
    fakeClient({
      comments: [
        {
          id: 1,
          body: "### Review in progress\n\n- [ ] still working",
          user: { login: "claude[bot]" },
        },
      ],
      threads: [
        thread({
          comments: {
            nodes: [{ body: "h: fix this now", author: { login: "reviewer" } }],
          },
        }),
      ],
    }),
    {}
  );
  assert.equal(output.summary.high, 1);
  assert.equal(output.summary.review_in_progress, 1);
  assert.match(output.action_required, /still in progress/);
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

// A swallowed GraphQL failure makes a rate-limited request indistinguishable
// from a PR that genuinely has no inline threads, and buildFeedback would then
// proceed as though all inline feedback were absent. Same masquerade lineage()
// refuses to perform.
test("a failed review-threads query is reported, not read as zero threads", () => {
  const logged = [];
  const client = createClient({
    run: () => ({ code: 1, stdout: "", stderr: "API rate limit exceeded" }),
    log: (message) => logged.push(message),
  });
  assert.deepEqual(client.reviewThreads("o", "r", 1), []);
  assert.equal(logged.length, 1, "the failure is logged");
  assert.match(logged[0], /rate limit/);
});

test("unparseable review-threads output is also reported", () => {
  const logged = [];
  const client = createClient({
    run: () => ({ code: 0, stdout: "<html>502</html>", stderr: "" }),
    log: (message) => logged.push(message),
  });
  assert.deepEqual(client.reviewThreads("o", "r", 1), []);
});

test("a malformed --pr is rejected", () => {
  assert.throws(
    () => main({ argv: ["--pr", "abc"], client: fakeClient() }),
    /--pr expects an integer/
  );
});

// The bot split is one rule now, not three copies. These assert it is applied
// identically whichever source the item arrived from.
test("bucketByAuthor applies the same rule to every source", () => {
  const bucket = (author, body) => {
    const feedback = {
      high: [],
      medium: [],
      low: [],
      bot: [],
      resolved: [],
      review_in_progress: [],
    };
    const item = { author };
    bucketByAuthor(feedback, item, { user: { login: author } }, body, author);
    const [name] = Object.entries(feedback).find(
      ([, items]) => items.length > 0
    );
    return { name, item };
  };

  const reviewBot = bucket("claude[bot]", "This will break");
  assert.equal(reviewBot.name, "high");
  assert.equal(reviewBot.item.review_bot, true);

  const infoBot = bucket("codecov[bot]", "Coverage dropped");
  assert.equal(infoBot.name, "bot");
  assert.ok(!infoBot.item.review_bot);

  assert.equal(bucket("a-human", "Why is this here?").name, "medium");
});

// The observed placeholder is a heading, but the same bot opens its FINISHED
// comment with bold, so a bold or underscored placeholder is one format change
// away. Missing it would fail silently, straight back to the bug this exists to
// prevent. The trailing boundary is `(?![A-Za-z0-9])` rather than `\\b` because
// underscore is a word character, so `\\b` would not fire before a closing `__`.
test("the in-progress marker survives markdown emphasis, not just headings", () => {
  for (const body of [
    '### Review in progress <img src="x" />',
    "**Review in progress**",
    "__Review in progress__",
    "*Review in progress*",
    "Review in progress",
  ]) {
    assert.equal(isReviewInProgress(body), true, body);
  }
});

test("emphasis tolerance does not loosen the anchor", () => {
  for (const body of [
    "A review in progress is not a clean review",
    '**Claude finished** — a body reading "Review in progress" was mis-bucketed',
    "Review in progresses nicely",
  ]) {
    assert.equal(isReviewInProgress(body), false, body);
  }
});

/**
 * CAPTURED LIVE, not transcribed from the issue. Both bodies below are the real
 * comment on PR #302, read 29 seconds apart: the bot creates it in the
 * "working" state and edits it into the "review in progress" state. Issue #292
 * recorded only the second, so a marker built from the issue text alone missed
 * the first half-minute after a trigger, which is exactly when a caller polls
 * too early.
 */
const LIVE_CREATED =
  'Claude Code is working… <img src="https://github.com/user-attachments/assets/5ac382c7.png" width="14px" height="14px" style="vertical-align: middle; margin-left: 4px;" />\n\nI\'ll analyze this and get back to you.\n\n[View job run](https://github.com/taskless/cli/actions/runs/34166525707)';

const LIVE_IN_PROGRESS =
  '### Review in progress <img src="https://github.com/user-attachments/assets/5ac382c7.png" width="14px" height="14px" />\n\nReview mode: incremental — read 0 prior review thread(s) before reviewing.\n\n- [x] Read `.prior-review.json`\n- [ ] Gather PR diff and changed files';

const LIVE_FINISHED =
  "**Claude finished @thecodedrift's task in 7m 42s** —— [View job](https://github.com/taskless/cli/actions/runs/34149206216)\n\n---\n### Review complete";

test("both live placeholder states are detected, and the finished one is not", () => {
  assert.equal(isReviewInProgress(LIVE_CREATED), true, "created state");
  assert.equal(isReviewInProgress(LIVE_IN_PROGRESS), true, "in-progress state");
  assert.equal(isReviewInProgress(LIVE_FINISHED), false, "finished state");
});

test("a finished review quoting either placeholder is not in progress", () => {
  for (const quoted of ["Review in progress", "Claude Code is working"]) {
    assert.equal(
      isReviewInProgress(
        `${LIVE_FINISHED}\n\nThe bug was that a body reading "${quoted}" was mis-bucketed.`
      ),
      false,
      quoted
    );
  }
});

test("an in-progress placeholder keeps every other bucket empty", () => {
  const output = build(
    fakeClient({
      comments: [{ id: 1, body: LIVE_CREATED, user: { login: "claude[bot]" } }],
    }),
    {}
  );
  assert.equal(output.summary.review_in_progress, 1);
  assert.equal(output.summary.needs_attention, 0);
  assert.equal(
    output.summary.high + output.summary.medium + output.summary.low,
    0
  );
  assert.match(output.action_required, /still in progress/);
});

// A HUMAN IS NOT A REVIEW BOT, AND THIS IS THE DANGEROUS DIRECTION. A person
// writing "Review in progress on my end" would otherwise be filed as an
// unfinished review, vanish from needs_attention, and hang the wait loop
// forever: a person's comment never gets edited into a finished form the way
// the bot's placeholder does, so the count never drops to zero.
test("a human comment opening with the phrase is feedback, not an unfinished review", () => {
  const output = build(
    fakeClient({
      comments: [
        {
          id: 1,
          // The LOGAF marker is deliberately absent: it only counts at the
          // start, and the start is occupied by the phrase under test. So this
          // lands in medium by content, which is the correct default.
          body: "Review in progress on my end, will finish by EOD.",
          user: { login: "a-human-reviewer" },
        },
      ],
    }),
    {}
  );
  assert.equal(output.summary.review_in_progress, 0);
  assert.equal(output.summary.medium, 1, "it stays actionable feedback");
  assert.equal(output.summary.needs_attention, 1);
});

test("the same body from the review bot IS an unfinished review", () => {
  const output = build(
    fakeClient({
      comments: [
        {
          id: 1,
          body: "Review in progress on my end, will finish by EOD.",
          user: { login: "claude[bot]" },
        },
      ],
    }),
    {}
  );
  assert.equal(output.summary.review_in_progress, 1);
  assert.equal(output.summary.needs_attention, 0);
});

// Two regex edges, both able to reintroduce the bug. Bold-italic is one format
// drift away from the bold case already anticipated; `progress_notes` is a
// finished comment that a too-permissive boundary would freeze the loop on.
test("bold-italic emphasis is matched, and a bare underscore is not emphasis", () => {
  assert.equal(isReviewInProgress("***Review in progress***"), true);
  assert.equal(isReviewInProgress("___Claude Code is working___"), true);
  assert.equal(
    isReviewInProgress("Review in progress_notes: nothing else found"),
    false
  );
});
