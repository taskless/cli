#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * Fetch and categorize PR review feedback.
 *
 * Usage:
 *     node fetch_pr_feedback.cjs [--pr PR_NUMBER]
 *
 * If --pr is not specified, uses the PR for the current branch.
 *
 * Output: JSON to stdout with categorized feedback.
 *
 * Categories (using the LOGAF scale — see
 * https://develop.sentry.dev/engineering-practices/code-review/#logaf-scale):
 * - high: Must address before merge (h:, blocker, changes requested)
 * - medium: Should address (m:, standard feedback)
 * - low: Optional suggestions (l:, nit, style)
 * - bot: Informational automated comments (Codecov, Dependabot, etc.)
 * - resolved: Already resolved threads
 *
 * Bot classification:
 * - Review bots (Sentry, Warden, Cursor, Bugbot, etc.) provide actionable code
 *   feedback. Their comments are categorized by content into high/medium/low
 *   with a `review_bot: true` flag — they are NOT placed in the `bot` bucket.
 * - Info bots (Codecov, Dependabot, Renovate, etc.) post status reports and are
 *   placed in the `bot` bucket for silent skipping.
 *
 * Self-review feedback:
 * - You can't formally "Request changes" on your own PR, so a PR author's own
 *   feedback arrives as `COMMENTED` review summaries and ordinary review
 *   **threads**, not as changes-requested items. These are surfaced (not
 *   dropped) and flagged `self_review: true`, bucketed by content — defaulting
 *   to `medium` when no `h:/m:/l:` prefix is present.
 */

const { parseArgs } = require("node:util");

const {
  FatalError,
  UsageError,
  parseIntegerOption,
  prView,
  runGh,
  runProcess,
} = require("./shared.cjs");

// Bots that provide actionable code review feedback (security issues, lint
// violations, bugs). Their comments are categorized by content, not skipped.
const REVIEW_BOT_PATTERNS = [
  /^sentry/i,
  /^warden/i,
  /^cursor/i,
  /^bugbot/i,
  /^seer/i,
  /^copilot/i,
  /^codex/i,
  /^claude/i,
  /^codeql/i,
];

// Bots that post informational status reports (coverage, dependency updates).
// These are placed in the `bot` bucket and skipped silently.
const INFO_BOT_PATTERNS = [
  /^codecov/i,
  /^dependabot/i,
  /^renovate/i,
  /^github-actions/i,
  /^mergify/i,
  /^semantic-release/i,
  /^sonarcloud/i,
  /^snyk/i,
  /bot$/i,
  /\[bot\]$/i,
];

const REVIEW_THREADS_QUERY = `
    query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              isOutdated
              path
              line
              comments(first: 10) {
                nodes {
                  id
                  body
                  author {
                    login
                  }
                  createdAt
                }
              }
            }
          }
        }
      }
    }
    `;

/** Whether a username matches a review bot that posts actionable feedback. */
const isReviewBot = (username) =>
  REVIEW_BOT_PATTERNS.some((pattern) => pattern.test(username ?? ""));

/** Whether a username matches an informational bot (skip silently). */
const isInfoBot = (username) =>
  INFO_BOT_PATTERNS.some((pattern) => pattern.test(username ?? ""));

/**
 * Detect a LOGAF marker at the start of a comment body.
 *
 * - l: / [l] / low: → low priority (optional)
 * - m: / [m] / medium: → medium priority (should address)
 * - h: / [h] / high: → high priority (must address)
 *
 * Returns 'high', 'medium', 'low', or null when no marker is present.
 */
const detectLogaf = (body) => {
  const patterns = [
    [/^\s*(?:h:|h\s*:|high:|\[h])/i, "high"],
    [/^\s*(?:m:|m\s*:|medium:|\[m])/i, "medium"],
    [/^\s*(?:l:|l\s*:|low:|\[l])/i, "low"],
  ];
  for (const [pattern, level] of patterns) {
    if (pattern.test(body)) return level;
  }
  return null;
};

const HIGH_PATTERNS = [
  /must\s+(fix|change|update|address)/i,
  /this\s+(is\s+)?(wrong|incorrect|broken|buggy)/i,
  /security\s+(issue|vulnerability|concern)/i,
  /will\s+(break|cause|fail)/i,
  /critical/i,
  /blocker/i,
];

const LOW_PATTERNS = [
  /nit[:\s]/i,
  /nitpick/i,
  /suggestion[:\s]/i,
  /consider\s+/i,
  /could\s+(also\s+)?/i,
  /might\s+(want\s+to|be\s+better)/i,
  /optional[:\s]/i,
  /minor[:\s]/i,
  /style[:\s]/i,
  /prefer\s+/i,
  /what\s+do\s+you\s+think/i,
  /up\s+to\s+you/i,
  /take\s+it\s+or\s+leave/i,
  /fwiw/i,
];

/**
 * Categorize a comment by content and author, on the LOGAF scale.
 *
 * Info bots are skipped silently; review bots fall through to content
 * categorization so their actionable feedback is not lost.
 */
const categorizeComment = (comment, body) => {
  const author = comment?.author?.login || comment?.user?.login || "";

  if (isInfoBot(author) && !isReviewBot(author)) return "bot";

  const logaf = detectLogaf(body);
  if (logaf) return logaf;

  if (HIGH_PATTERNS.some((pattern) => pattern.test(body))) return "high";
  if (LOW_PATTERNS.some((pattern) => pattern.test(body))) return "low";

  // Default to medium for non-bot comments without clear indicators.
  return "medium";
};

/**
 * File one item by its author: a review bot is flagged and bucketed by content,
 * an info bot is filed as `bot`, everyone else is bucketed by content.
 *
 * The three sources (review summaries, review threads, issue comments) each
 * wrap this with their own precondition — changes-requested, resolved,
 * acknowledged — but the bot classification itself is one rule in one place, so
 * a new pattern list or a change to the split cannot be applied to two of the
 * three by accident.
 */
const bucketByAuthor = (feedback, item, comment, body, author) => {
  if (isReviewBot(author)) {
    item.review_bot = true;
    feedback[categorizeComment(comment, body)].push(item);
  } else if (isInfoBot(author)) {
    feedback.bot.push(item);
  } else {
    feedback[categorizeComment(comment, body)].push(item);
  }
};

/** Build a standardized feedback item, omitting every flag that is not set. */
const extractFeedbackItem = ({
  body,
  author,
  path,
  line,
  url,
  isResolved = false,
  isOutdated = false,
  reviewBot = false,
  selfReview = false,
  threadId,
  commentId,
  acknowledged = false,
}) => {
  const truncated = body.length > 200 ? `${body.slice(0, 200)}...` : body;
  const item = {
    author,
    body: truncated.replaceAll("\n", " ").trim(),
    full_body: body,
  };

  if (path) item.path = path;
  if (line) item.line = line;
  if (url) item.url = url;
  if (isResolved) item.resolved = true;
  if (isOutdated) item.outdated = true;
  if (reviewBot) item.review_bot = true;
  if (selfReview) item.self_review = true;
  if (threadId) item.thread_id = threadId;
  if (commentId !== undefined && commentId !== null)
    item.comment_id = commentId;
  if (acknowledged) item.acknowledged = true;

  return item;
};

/**
 * A gh client bundling the calls this script makes, so `buildFeedback` can be
 * driven by a fake in tests without a network or a repository.
 */
const createClient = ({ run = runProcess, log = console.error } = {}) => {
  const options = { run, log };
  let viewerLogin;
  let viewerLookupFailed = false;

  return {
    repoInfo() {
      const result = runGh(["repo", "view", "--json", "owner,name"], options);
      if (!result) return null;
      return [result.owner?.login, result.name];
    },

    prInfo(prNumber) {
      return prView(
        "number,url,headRefName,author,reviews,reviewDecision",
        prNumber,
        options
      );
    },

    /**
     * Requested reviewers who haven't submitted a review yet.
     *
     * GitHub drops a reviewer from these lists once they submit, so what remains
     * is exactly the outstanding set. Teams are included as `@org/team` — a PR
     * awaiting only a team review would otherwise report zero pending reviewers
     * and exit the wait loop early.
     */
    requestedReviewers(owner, repo, prNumber) {
      const pr = runGh(
        ["api", `repos/${owner}/${repo}/pulls/${prNumber}`],
        options
      );
      if (!pr || typeof pr !== "object" || Array.isArray(pr)) return [];
      const users = (pr.requested_reviewers ?? [])
        .map((u) => u?.login)
        .filter(Boolean);
      const teams = (pr.requested_teams ?? [])
        .filter((t) => t?.slug)
        .map((t) => `@${t.slug}`);
      return [...users, ...teams];
    },

    issueComments(owner, repo, prNumber) {
      const result = runGh(
        [
          "api",
          `repos/${owner}/${repo}/issues/${prNumber}/comments`,
          "--paginate",
        ],
        options
      );
      return Array.isArray(result) ? result : [];
    },

    /**
     * Review threads with resolution status, via GraphQL.
     *
     * Routed through `runGh` like every other call here, so a failure is
     * REPORTED. Swallowing it makes a rate-limited or flaky request
     * indistinguishable from a PR that genuinely has no inline threads, and
     * `buildFeedback` would then proceed as though all inline feedback were
     * absent — the same masquerade `lineage()` refuses to perform.
     */
    reviewThreads(owner, repo, prNumber) {
      const data = runGh(
        [
          "api",
          "graphql",
          "-f",
          `query=${REVIEW_THREADS_QUERY}`,
          "-F",
          `owner=${owner}`,
          "-F",
          `repo=${repo}`,
          "-F",
          `pr=${prNumber}`,
        ],
        options
      );
      return data?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    },

    /** Login of the authenticated gh user, looked up once per run. */
    viewerLogin() {
      if (viewerLogin === undefined && !viewerLookupFailed) {
        // No --jq here: the result is JSON.parse'd, and --jq emits a bare
        // unquoted string that is not valid JSON.
        const result = runGh(["api", "user"], options);
        const login =
          result && typeof result === "object" ? result.login : null;
        if (login) {
          viewerLogin = login;
        } else {
          viewerLookupFailed = true;
        }
      }
      return viewerLogin ?? null;
    },

    /**
     * Whether *we* left the acknowledgement reaction on this comment.
     *
     * The count on the comment payload is every user's reaction, so a maintainer
     * celebrating a review would otherwise mark it handled and silently drop
     * real feedback. Only our own reaction counts. The per-comment lookup is
     * skipped entirely when the count is zero, so the common case costs nothing.
     *
     * Fails closed: if the viewer cannot be identified or the lookup errors, the
     * item is treated as unacknowledged and resurfaces, which is the safe
     * direction — answering twice beats dropping feedback.
     */
    hasOurAcknowledgement(owner, repo, commentId, hoorayCount) {
      if (!(hoorayCount > 0)) return false;
      const viewer = this.viewerLogin();
      if (!viewer) return false;
      const reactions = runGh(
        [
          "api",
          `repos/${owner}/${repo}/issues/comments/${commentId}/reactions`,
          "--paginate",
        ],
        options
      );
      if (!Array.isArray(reactions)) return false;
      return reactions.some(
        (r) => r?.content === "hooray" && r?.user?.login === viewer
      );
    },
  };
};

/** Gather every source of feedback for one PR and bucket it. */
const buildFeedback = (client, { owner, repo, prInfo }) => {
  const prNumber = prInfo.number;
  const prAuthor = prInfo.author?.login ?? "";

  const feedback = { high: [], medium: [], low: [], bot: [], resolved: [] };

  // Review summary bodies. Every non-empty summary is surfaced, regardless of
  // author: a self-review can't be "Request changes", so the PR author's own
  // feedback arrives as COMMENTED summaries and would otherwise be dropped. A
  // real reviewer's CHANGES_REQUESTED is always high; everything else is
  // bucketed by content (default medium).
  for (const review of prInfo.reviews ?? []) {
    const author = review.author?.login ?? "";
    const body = review.body ?? "";

    // Skip empty summaries: a bare approval, or a review whose only content is
    // inline comments (those arrive via reviewThreads below).
    if (!body || body.trim().length < 3) continue;

    const isSelf = author === prAuthor;
    const state = review.state ?? "";
    const item = extractFeedbackItem({ body, author, selfReview: isSelf });
    item.type =
      state === "CHANGES_REQUESTED" ? "changes_requested" : "review_summary";

    if (
      state === "CHANGES_REQUESTED" &&
      !isSelf &&
      !isReviewBot(author) &&
      !isInfoBot(author)
    ) {
      feedback.high.push(item);
    } else {
      bucketByAuthor(feedback, item, review, body, author);
    }
  }

  // Review threads (inline comments with resolution status).
  for (const thread of client.reviewThreads(owner, repo, prNumber)) {
    const comments = thread?.comments?.nodes ?? [];
    if (comments.length === 0) continue;

    const first = comments[0];
    const author = first.author?.login ?? "";
    const body = first.body ?? "";

    // Skip empty or very short comments.
    if (!body || body.trim().length < 3) continue;

    // The PR author's own inline comments are NOT skipped: a self-review's
    // design comments arrive as ordinary review threads and are real feedback
    // for the iterate loop. Flag them so callers can tell them apart.
    const isSelf = author === prAuthor;
    const isResolved = thread.isResolved ?? false;

    const item = extractFeedbackItem({
      body,
      author,
      path: thread.path,
      line: thread.line,
      isResolved,
      isOutdated: thread.isOutdated ?? false,
      selfReview: isSelf,
      threadId: thread.id,
    });

    if (isResolved) {
      feedback.resolved.push(item);
    } else {
      bucketByAuthor(feedback, item, first, body, author);
    }
  }

  // Issue comments (general PR conversation).
  for (const comment of client.issueComments(owner, repo, prNumber)) {
    const author = comment.user?.login ?? "";
    const body = comment.body ?? "";

    if (author === prAuthor) continue;
    if (!body || body.trim().length < 3) continue;

    // Our own 🎉 reaction is the machine-readable "this was handled" marker for
    // top-level comments, which have no thread to resolve. Scoped to the
    // authenticated user: an unrelated 🎉 from anyone else must not silence real
    // feedback. Set it after replying; see the skill's "Replying to Comments".
    const acknowledged = client.hasOurAcknowledgement(
      owner,
      repo,
      comment.id ?? 0,
      comment.reactions?.hooray ?? 0
    );

    const item = extractFeedbackItem({
      body,
      author,
      url: comment.html_url,
      commentId: comment.id,
      acknowledged,
    });

    if (acknowledged) {
      feedback.resolved.push(item);
      continue;
    }

    bucketByAuthor(feedback, item, comment, body, author);
  }

  const requestedReviewers = client.requestedReviewers(owner, repo, prNumber);
  const priorities = ["high", "medium", "low"];
  const countFlagged = (flag) =>
    priorities.reduce(
      (total, bucket) => total + feedback[bucket].filter((i) => i[flag]).length,
      0
    );

  const output = {
    pr: {
      number: prNumber,
      url: prInfo.url ?? "",
      author: prAuthor,
      review_decision: prInfo.reviewDecision ?? "",
      requested_reviewers: requestedReviewers,
    },
    summary: {
      high: feedback.high.length,
      medium: feedback.medium.length,
      low: feedback.low.length,
      bot_comments: feedback.bot.length,
      resolved: feedback.resolved.length,
      review_bot_feedback: countFlagged("review_bot"),
      self_review_feedback: countFlagged("self_review"),
      needs_attention: feedback.high.length + feedback.medium.length,
      pending_reviewers: requestedReviewers.length,
    },
    feedback,
  };

  if (feedback.high.length > 0) {
    output.action_required = "Address high-priority feedback before merge";
  } else if (feedback.medium.length > 0) {
    output.action_required = "Address medium-priority feedback";
  } else if (feedback.low.length > 0) {
    output.action_required =
      "Review low-priority suggestions - ask user which to address";
  } else {
    output.action_required = null;
  }

  return output;
};

const main = ({
  argv = process.argv.slice(2),
  client = createClient(),
} = {}) => {
  const { values } = parseArgs({
    args: argv,
    options: { pr: { type: "string" } },
  });

  // Validate arguments BEFORE any network call: a typo in --pr should not
  // require a working gh session to report, and argparse rejected up front.
  const prNumber = parseIntegerOption("pr", values.pr);

  const repoInfo = client.repoInfo();
  if (!repoInfo) {
    return { output: { error: "Could not determine repository" }, code: 1 };
  }
  const [owner, repo] = repoInfo;

  const prInfo = client.prInfo(prNumber);
  if (!prInfo) {
    return { output: { error: "No PR found for current branch" }, code: 1 };
  }

  return { output: buildFeedback(client, { owner, repo, prInfo }), code: 0 };
};

if (require.main === module) {
  try {
    const { output, code } = main({});
    console.log(JSON.stringify(output, null, 2));
    process.exit(code);
  } catch (error) {
    if (error instanceof FatalError) {
      console.error(error.message);
      process.exit(error instanceof UsageError ? 2 : 1);
    }
    throw error;
  }
}

module.exports = {
  bucketByAuthor,
  buildFeedback,
  categorizeComment,
  createClient,
  detectLogaf,
  extractFeedbackItem,
  isInfoBot,
  isReviewBot,
  main,
};
