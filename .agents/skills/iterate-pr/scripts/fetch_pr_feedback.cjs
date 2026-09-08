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
 * - review_in_progress: A review bot's placeholder comment, posted the instant
 *   it was triggered and not yet edited to its finished form — not feedback
 *   yet, see "Unfinished reviews" below
 * - review_summary: A review's top-level narration, bucketed structurally
 *   rather than by content — surfaced and counted
 *   (`summary.review_summaries`), but never a priority bucket and never
 *   prompted on, see "Review summaries" below
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
 *   dropped) and flagged `self_review: true`. A self-review **thread** (an
 *   inline comment) is bucketed by content like any other, defaulting to
 *   `medium` absent a `h:/m:/l:` prefix. A self-review **summary** is bucketed
 *   structurally, not by content — see "Review summaries" below — landing in
 *   the `review_summary` bucket absent a marker, so it stays visible without
 *   ever being read as a priority-bucket finding.
 *
 * Review summaries:
 * - A review's top-level summary narrates its findings, so classifying it by
 *   content is unreliable: the prose is full of finding vocabulary, often
 *   negated ("not a blocker", "no security issue"), and no pattern list
 *   survives that. A summary is instead bucketed by what is structurally
 *   known: `CHANGES_REQUESTED` from a reviewer who is not the PR author is
 *   `high`; an explicit `h:/m:/l:` marker still wins over everything; absent
 *   both, the summary goes to its own `review_summary` bucket (counted as
 *   `summary.review_summaries`), NOT `low` — `low` means "an optional
 *   suggestion, ask the user which to address," and a review that found
 *   nothing proposes no work, so filing it there trades the false `high` this
 *   fix removes for a false prompt. The findings a review raises arrive
 *   separately as inline review-thread comments, which ARE classified by
 *   content — nothing is lost by not re-classifying the narration around
 *   them.
 *
 * Unfinished reviews:
 * - The Claude review bot posts its comment immediately when triggered and
 *   edits it in place as it works, so the comment existing, its `created_at`,
 *   and the check run concluding `success` are all NOT completion signals — a
 *   run has been observed to report success while the body still read "Review
 *   in progress" with unchecked boxes. The only reliable signal is that the
 *   body no longer OPENS with the in-progress marker. An item whose body still
 *   opens with it is filed in its own `review_in_progress` bucket rather than
 *   `high`/`medium`/`low`/`resolved` — it is not feedback yet, and bucketing it
 *   as an ordinary comment produces `needs_attention: 0` indistinguishable from
 *   "reviewed, nothing found".
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
 * The placeholders a review bot posts before it has anything to say.
 *
 * THERE IS MORE THAN ONE, WHICH IS THE WHOLE TRAP. Measured live on PR #302,
 * the comment is created in one state and edited into another 29 seconds later,
 * then edited again on completion:
 *
 *   22:24:05  Claude Code is working… <img …>        (created)
 *   22:24:34  ### Review in progress <img …>          (+29s, checkboxes appear)
 *   on finish **Claude finished …**
 *
 * Matching only the second one leaves the first half-minute after a trigger
 * undetected, which is precisely when a caller polls too early. Issue #292
 * captured the middle state, so a marker derived from the issue text alone
 * misses the opening one.
 *
 * Anchored to the START of the (trimmed) body: a review that legitimately
 * discusses this behaviour, quoting a phrase mid-body the way this very fix
 * does, must not read as unfinished forever.
 *
 * Leading markdown emphasis is tolerated as well as heading hashes. The
 * observed placeholder is a heading, but the same bot opens its FINISHED
 * comment with bold, so a bold placeholder is a format change away, and missing
 * it would fail silently.
 *
 * REJECTED ALTERNATIVE, recorded so it is not re-proposed: invert this into an
 * allowlist, treating any review-bot comment that does not open with a
 * completion marker as unfinished. It fails safe for THIS bot, but the other
 * review bots (Sentry, Cursor, Copilot, CodeQL) have no completion marker at
 * all, so every comment they ever post would read as unfinished and the wait
 * loop would never exit. A blocklist of measured placeholders is narrower and
 * cannot stall a caller. The cost is that a NEW placeholder wording is missed,
 * so when this bot changes its output, add the new opening here.
 *
 * Emphasis is unbounded (`[*_]*`) rather than capped at two, so bold-italic
 * (`***…***`) matches; a cap of two failed it, since two of the three leading
 * `*` were consumed and the phrase could not then start.
 *
 * The trailing side consumes closing emphasis and THEN refuses a word
 * character, underscore included. `\b` alone would not fire before a closing
 * `__`, but a bare `(?![A-Za-z0-9])` went too far the other way and matched
 * `Review in progress_notes: …`, a finished comment. Consuming `[*_]*` first
 * and excluding `_` from the lookahead accepts `__…__` and rejects
 * `progress_notes`.
 */
const IN_PROGRESS_MARKERS = [
  /^#{0,6}\s*[*_]*\s*review in progress[*_]*(?![A-Za-z0-9_])/i,
  /^#{0,6}\s*[*_]*\s*claude code is working[*_]*(?![A-Za-z0-9_])/i,
];

/** Whether a body still opens with one of the in-progress placeholders. */
const isReviewInProgress = (body) => {
  const opening = body.trimStart();
  return IN_PROGRESS_MARKERS.some((marker) => marker.test(opening));
};

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

// Word-bounded so a leading word is matched regardless of what punctuation (or
// none at all) follows it. These five used to require a colon or whitespace
// right after the word (`nit[:\s]`), which matched `nit:` and `nit ` but not
// the common `Nit,` spelling — measured on a real inline comment from #304
// that opened `Nit, not a defect:` and was filed medium instead of low.
const LOW_PATTERNS = [
  /\bnit\b/i,
  /nitpick/i,
  /\bsuggestion\b/i,
  /consider\s+/i,
  /could\s+(also\s+)?/i,
  /might\s+(want\s+to|be\s+better)/i,
  /\boptional\b/i,
  /\bminor\b/i,
  /\bstyle\b/i,
  /prefer\s+/i,
  /what\s+do\s+you\s+think/i,
  /up\s+to\s+you/i,
  /take\s+it\s+or\s+leave/i,
  /fwiw/i,
];

// A HIGH/LOW pattern match is discarded when one of these words appears
// shortly before it, so "not a blocker" and "no security issue" stop reading
// as findings. Measured on the real review summary of #307: "…so it's a
// 'worth a look,' not a blocker" matched `blocker` with nothing to say the
// word was negated.
//
// Contractions are listed explicitly rather than derived from their expanded
// form (`won't` alongside `will not`) because `\b` does not split on an
// apostrophe the way it splits on a space — `won't` has to appear as its own
// alternative or it is invisible to this pattern. Caught in review on #311:
// the first cut only had `isn't`/`is not`, so "doesn't block", "won't break",
// "can't fail", "never a blocker", and a bare "nothing" all still read as
// unnegated and reached `high`.
const NEGATORS =
  /\b(?:not|no|non|none|nothing|never|without|isn't|is not|aren't|are not|wasn't|was not|weren't|were not|won't|will not|wouldn't|would not|can't|cannot|can not|couldn't|could not|shouldn't|should not|doesn't|does not|didn't|did not|hasn't|has not|haven't|have not|hadn't|had not)\b/i;

// How far back from a match to look for a negator. Wide enough to cover "is
// not a blocker" and "found no security issue", narrow enough that an
// unrelated negation earlier in a long sentence doesn't suppress a real
// finding.
const NEGATION_WINDOW = 24;

/** Whether a negator appears in the window immediately before `index`. */
const isNegated = (body, index) => {
  const start = Math.max(0, index - NEGATION_WINDOW);
  return NEGATORS.test(body.slice(start, index));
};

/**
 * Whether any pattern matches `body` at a position not preceded by a negator.
 *
 * Scans every occurrence of a pattern, not just the first: `pattern.exec`
 * always returns the left-most match, so a naive single check would read a
 * negated first mention as covering the whole body and miss a later, genuine
 * one — e.g. "not a blocker overall, but there's a real blocker in the retry
 * logic" has two matches of `/blocker/i`, only the first of which is negated.
 * Caught in review on #311.
 */
const matchesUnnegated = (patterns, body) =>
  patterns.some((pattern) => {
    // Clone with a `g` flag so `.exec` advances instead of always returning
    // the left-most match; the source patterns stay non-global everywhere
    // else they're used (a global regex carries mutable `lastIndex` state,
    // which is exactly the kind of shared mutable state worth not spreading).
    const global = new RegExp(pattern.source, `${pattern.flags}g`);
    let match;
    while ((match = global.exec(body)) !== null) {
      if (!isNegated(body, match.index)) return true;
      // A zero-length match would otherwise leave `lastIndex` unchanged and
      // loop forever; none of the patterns here can match empty, but this
      // keeps the loop safe if one ever does.
      if (match[0].length === 0) global.lastIndex += 1;
    }
    return false;
  });

/**
 * Categorize a comment by content and author, on the LOGAF scale.
 *
 * Info bots are skipped silently; review bots fall through to content
 * categorization so their actionable feedback is not lost.
 *
 * This is for INLINE feedback (review threads, issue comments) only — a
 * single comment that either raises one finding or doesn't. A review
 * SUMMARY narrates a whole review and is handled separately by
 * `categorizeReviewSummary`, below, for the reason explained there.
 */
const categorizeComment = (comment, body) => {
  const author = comment?.author?.login || comment?.user?.login || "";

  if (isInfoBot(author) && !isReviewBot(author)) return "bot";

  const logaf = detectLogaf(body);
  if (logaf) return logaf;

  if (matchesUnnegated(HIGH_PATTERNS, body)) return "high";
  if (matchesUnnegated(LOW_PATTERNS, body)) return "low";

  // Default to medium for non-bot comments without clear indicators.
  return "medium";
};

/**
 * Categorize a review SUMMARY structurally, never by content.
 *
 * A summary's job is to narrate a review's findings, so it necessarily
 * contains finding vocabulary — often negated, as in "not a blocker" or "no
 * security issue found" — and no content pattern list survives that. The
 * findings themselves arrive separately as inline review-thread comments and
 * are classified individually by `categorizeComment`; nothing is lost by not
 * re-classifying the prose that narrates them.
 *
 * An explicit LOGAF marker still wins, same as everywhere else. Absent one the
 * summary goes to its own `review_summary` bucket, which is surfaced and
 * counted but is not a priority bucket.
 *
 * NOT `low`, which was the obvious choice and is wrong here. `low` means "an
 * optional suggestion the user should be asked about": the skill presents low
 * items as a numbered list and asks which to address, and `action_required`
 * says so. Filing a review that found NOTHING there trades a false `high` for
 * a false prompt, asking someone to triage a summary that proposes no work.
 * Its own bucket is surfaced without being actionable, the same shape
 * `review_in_progress` already uses.
 *
 * A `CHANGES_REQUESTED` summary never reaches here; the caller files it `high`
 * on the review state, which is the structurally-known case that needs gating.
 */
const categorizeReviewSummary = (_comment, body) =>
  detectLogaf(body) ?? "review_summary";

/**
 * File one item by its author: an unfinished review is filed on its own ahead
 * of every other rule, a review bot is flagged and bucketed by content, an
 * info bot is filed as `bot`, everyone else is bucketed by content.
 *
 * The three sources (review summaries, review threads, issue comments) each
 * wrap this with their own precondition — changes-requested, resolved,
 * acknowledged — but the bot classification itself is one rule in one place, so
 * a new pattern list or a change to the split cannot be applied to two of the
 * three by accident. The in-progress check lives here for the same reason: an
 * unfinished placeholder must never be read as a review bot's finding (`high`),
 * an info bot's noise (`bot`), or ordinary human feedback, from ANY of the
 * three sources.
 *
 * `categorize` defaults to the inline-comment classifier; the review-summary
 * call site passes `categorizeReviewSummary` instead, so the bot/info-bot
 * split and the in-progress check stay one rule in one place while what
 * happens to the *content* differs by source.
 */
const bucketByAuthor = (
  feedback,
  item,
  comment,
  body,
  author,
  categorize = categorizeComment
) => {
  // The author gate is load-bearing, not belt and braces. A human writing
  // "Review in progress on my end, back by EOD" would otherwise be filed as an
  // unfinished review, vanish from `needs_attention`, and hang the wait loop
  // forever: a person's comment never gets edited into a finished form the way
  // the bot's placeholder does, so the count never drops. Only a review bot has
  // the lifecycle this bucket describes.
  if (isReviewBot(author) && isReviewInProgress(body)) {
    feedback.review_in_progress.push(item);
  } else if (isReviewBot(author)) {
    item.review_bot = true;
    feedback[categorize(comment, body)].push(item);
  } else if (isInfoBot(author)) {
    feedback.bot.push(item);
  } else {
    feedback[categorize(comment, body)].push(item);
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

  const feedback = {
    high: [],
    medium: [],
    low: [],
    bot: [],
    resolved: [],
    review_in_progress: [],
    review_summary: [],
  };

  // Review summary bodies. Every non-empty summary is surfaced, regardless of
  // author: a self-review can't be "Request changes", so the PR author's own
  // feedback arrives as COMMENTED summaries and would otherwise be dropped. A
  // real reviewer's CHANGES_REQUESTED is always high; everything else is
  // bucketed structurally, not by content — see `categorizeReviewSummary`.
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
      bucketByAuthor(
        feedback,
        item,
        review,
        body,
        author,
        categorizeReviewSummary
      );
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
  // `review_summary` counts here even though it is not a priority bucket:
  // these tallies answer "how much of this came from a bot / from the author",
  // which is independent of urgency. Leaving it out would silently zero
  // `self_review_feedback` for an author whose only note is a review summary,
  // which is the common shape of a self-review. `review_in_progress` stays out:
  // it is not feedback yet.
  const priorities = ["high", "medium", "low", "review_summary"];
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
      review_in_progress: feedback.review_in_progress.length,
      review_summaries: feedback.review_summary.length,
      needs_attention: feedback.high.length + feedback.medium.length,
      pending_reviewers: requestedReviewers.length,
    },
    feedback,
  };

  // `review_in_progress` outranks everything else: it is the one condition a
  // caller must not resolve by "stopping", the exact silent-success shape this
  // field exists to prevent. A caller that sees needs_attention: 0 and quits
  // would otherwise conclude a review that hasn't started yet is a clean one.
  // Existing high/medium/low items are still all present in `feedback` and are
  // not blocked on this — only the "nothing left to do" reading is.
  if (feedback.review_in_progress.length > 0) {
    output.action_required =
      "A review is still in progress - wait for it to finish before treating feedback as final";
  } else if (feedback.high.length > 0) {
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
  categorizeReviewSummary,
  createClient,
  detectLogaf,
  extractFeedbackItem,
  isInfoBot,
  isReviewBot,
  isReviewInProgress,
  main,
};
