---
name: iterate-pr
description: Iterate on a PR until CI passes. Use when you need to fix CI failures, address review feedback, or continuously push fixes until all checks are green. Automates the feedback-fix-push-wait cycle.
---

<!--
Forked from Sentry's iterate-pr skill (Apache-2.0):
https://github.com/getsentry/skills/tree/main/skills/iterate-pr
Substantially modified: stack-aware tooling, LOGAF feedback bucketing,
self-review handling, and pending-reviewer tracking.
-->

# Iterate on PR Until CI Passes

Continuously iterate on the current branch until all CI checks pass and review feedback is addressed.

**Requires**: GitHub CLI (`gh`) authenticated.

**Important**: All scripts must be run from the repository root directory (where `.git` is located), not from the skill directory. Use the full path to the script via `${CLAUDE_SKILL_ROOT}`.

**Shell gotcha**: the agent's Bash tool MAY run under a non-bash shell (e.g. **zsh**). **Always check the current shell before running commands** (`echo "$0"` / `ps -p $$ -o comm=`). It matters because zsh does NOT word-split unquoted variables the way bash does — `for x in $list; do …` iterates once over the whole string, not per token, which can silently send a loop down the wrong path. So any multi-step orchestration (cascade rebases, loops over branches/PRs, array iteration) MUST be wrapped in a `bash <<'EOF' … EOF` heredoc (or `bash -c`) so the semantics are guaranteed regardless of the login shell — never write it as an inline loop. For destructive git fan-out (rebase + force-push loops), add a guard that refuses to push if a rebase balloons — e.g. abort when `git rev-list --count <parent>..HEAD` exceeds the branch's own commit count, which catches a rebase that landed on the wrong parent _before_ it reaches the remote.

## Bundled Scripts

### `scripts/fetch_pr_checks.py`

Fetches CI check status and extracts failure snippets from logs.

```bash
uv run ${CLAUDE_SKILL_ROOT}/scripts/fetch_pr_checks.py [--pr NUMBER]
```

Returns JSON:

```json
{
  "pr": { "number": 123, "branch": "feat/foo" },
  "summary": { "total": 5, "passed": 3, "failed": 2, "pending": 0 },
  "checks": [
    { "name": "tests", "status": "fail", "log_snippet": "...", "run_id": 123 },
    { "name": "lint", "status": "pass" }
  ]
}
```

### `scripts/fetch_pr_feedback.py`

Fetches and categorizes PR review feedback using the [LOGAF scale](https://develop.sentry.dev/engineering-practices/code-review/#logaf-scale).

```bash
uv run ${CLAUDE_SKILL_ROOT}/scripts/fetch_pr_feedback.py [--pr NUMBER]
```

Returns JSON with feedback categorized as:

- `high` - Must address before merge (`h:`, blocker, changes requested)
- `medium` - Should address (`m:`, standard feedback)
- `low` - Optional (`l:`, nit, style, suggestion)
- `bot` - Informational automated comments (Codecov, Dependabot, etc.)
- `resolved` - Already resolved threads, and top-level comments carrying our own 🎉 acknowledgement

Review bot feedback (from Sentry, Warden, Copilot, Cursor, Bugbot, CodeQL, etc.) appears in `high`/`medium`/`low` with `review_bot: true` — it is NOT placed in the `bot` bucket.

**Self-review feedback** (from the PR author) appears in `high`/`medium`/`low` with `self_review: true`. Because you can't "Request changes" on your own PR, a self-review lands as `COMMENTED` review summaries and ordinary review threads rather than changes-requested items — these are surfaced (not dropped) and bucketed by content, defaulting to `medium` when there's no `h:/m:/l:` prefix. Treat `self_review` items the same as any other human feedback in step 3.

Each feedback item may also include:

- `thread_id` - GraphQL node ID for inline review comments (used for replies)
- `pending_reviewers` (in `summary`) - count of requested reviewers who have not submitted yet; `pr.requested_reviewers` lists them

### `scripts/resolve_pr_threads.py`

Resolves PR review threads by their GraphQL node IDs — the bulk equivalent of the `resolveReviewThread` mutation below. Prefer it when closing out several threads at once.

```bash
uv run ${CLAUDE_SKILL_ROOT}/scripts/resolve_pr_threads.py THREAD_ID [THREAD_ID ...]
```

Returns JSON:

```json
{
  "resolved": ["PRRT_abc123", "PRRT_def456"],
  "failed": [],
  "already_resolved": ["PRRT_ghi789"]
}
```

### `scripts/stack_status.py`

Reports the health of a PR stack — **prefer this over hand-rolled `git rev-list`/`merge-base` shell loops** (which are zsh-fragile). Lineage comes from the open GitHub PRs (each PR's head → base), the shared source of truth — no local config. For every branch with a parent it prints ahead/behind vs origin, own-commit count, and whether it is cleanly stacked or **DIVERGED** (parent tip is not an ancestor → needs a restack). Operates purely on refs, independent of the checked-out branch.

```bash
uv run ${CLAUDE_SKILL_ROOT}/scripts/stack_status.py [--root <branch>]
```

### `scripts/propagate_stack.py`

Cascade-rebases a branch's descendants onto their parents to carry a fix up the stack — a focused restack that (unlike a whole-stack sync) never rebases onto the latest `main`, so fix-propagation stays decoupled from main-reconciliation. Lineage comes from the open GitHub PRs (head → base). It is topological (parent before child) and **guarded**: a balloon guard resets-without-pushing if a rebase lands on the wrong parent, and it stops on the first conflict for manual reconcile. Always prefer this to an inline rebase loop.

```bash
uv run ${CLAUDE_SKILL_ROOT}/scripts/propagate_stack.py --root <branch> [--dry-run] [--no-push]
```

## Workflow

### 1. Identify PR

```bash
gh pr view --json number,url,headRefName
```

Stop if no PR exists for the current branch.

### 2. Gather Review Feedback

Run `${CLAUDE_SKILL_ROOT}/scripts/fetch_pr_feedback.py` to get categorized feedback already posted on the PR.

### 3. Handle Feedback by LOGAF Priority

**Auto-fix (no prompt):**

- `high` - must address (blockers, security, changes requested)
- `medium` - should address (standard feedback)

When fixing feedback:

- Understand the root cause, not just the surface symptom
- Check for similar issues in nearby code or related files
- Fix all instances, not just the one mentioned

This includes review bot feedback (items with `review_bot: true`). Treat it the same as human feedback:

- Real issue found → fix it
- False positive → skip, but explain why in a brief comment
- Never silently ignore review bot feedback — always verify the finding

**Prompt user for selection:**

- `low` - present numbered list and ask which to address:

```
Found 3 low-priority suggestions:
1. [l] "Consider renaming this variable" - @reviewer in api.py:42
2. [nit] "Could use a list comprehension" - @reviewer in utils.py:18
3. [style] "Add a docstring" - @reviewer in models.py:55

Which would you like to address? (e.g., "1,3" or "all" or "none")
```

**Skip silently:**

- `resolved` threads
- `bot` comments (informational only — Codecov, Dependabot, etc.)

#### Replying to Comments

After processing a feedback item, acknowledge it on the PR so the trail shows what was addressed. How you reply depends on whether the item is an **inline thread** or a **top-level comment**.

**When to reply (both cases):**

- `high` and `medium` items — whether fixed or determined to be false positives
- `low` items — whether fixed or declined by the user
- `self_review` items — the same as any other human feedback

**Inline review-thread comments** (items with a `thread_id`):

1. Reply with the `addPullRequestReviewThreadReply` GraphQL mutation (`pullRequestReviewThreadId` + `body`).
2. Then resolve the thread with the `resolveReviewThread` mutation using the same `threadId` — a reply alone does not resolve it.

```graphql
mutation {
  resolveReviewThread(input: { threadId: "<thread_id>" }) {
    thread {
      isResolved
    }
  }
}
```

To close out several threads in one pass, use `scripts/resolve_pr_threads.py THREAD_ID [THREAD_ID ...]` instead of repeating the mutation. Resolve threads for `high`/`medium` items that were fixed or confirmed as false positives, and `low` items that were fixed or explicitly declined by the user — never where the action is unclear or still pending.

**Top-level comments** (items WITHOUT a `thread_id` — `review_summary` items and top-level PR/issue comments, e.g. a review bot like Claude that posts its findings as one top-level comment):

There is no thread to reply into, so post a **new top-level comment** — and when the item carries a `comment_id`, also **add a 🎉 reaction to the original**. The reaction is the machine-readable record that the item is handled: `fetch_pr_feedback.py` checks whether _we_ reacted and buckets the comment as `resolved`, so a re-run stops reporting it. Without it, every later pass re-surfaces the same comment and you have to reason about whether you already dealt with it.

```bash
gh pr comment <pr> --body "..."
gh api -X POST "repos/{owner}/{repo}/issues/comments/<comment_id>/reactions" -f content=hooray
```

Take the id from the item's `comment_id` rather than searching by body text. If you do need to look it up, use the **PR-scoped** endpoint _with_ `--paginate` — the repo-wide `repos/{owner}/{repo}/issues/comments` returns every comment in the repository, and the PR-scoped one defaults to 30 per page, so an unpaginated search silently misses comments on later pages:

```bash
gh api "repos/{owner}/{repo}/issues/<pr>/comments" --paginate \
  --jq '.[] | select(.id == <comment_id>) | .id'
```

**The reaction is scoped to us.** The script does not trust the raw reaction count — anyone can react 🎉 to a comment for unrelated reasons, and treating that as handled would silently drop real feedback. It confirms the reaction belongs to the authenticated user, and fails closed: if the viewer cannot be identified, the item resurfaces. Answering twice beats dropping something.

**Items without a `comment_id` cannot be reacted to.** GitHub exposes no reactions endpoint for a pull-request review body, so `review_summary` items — the text of a submitted review, as opposed to an ordinary PR conversation comment — have no reaction target. For those, dedupe by scanning existing top-level comments for one whose **reference marker** already cites this author and snippet. In practice most review bots post their findings as an ordinary comment, which does carry a `comment_id`.

A PR can carry several independent top-level comments, so a bare reply is ambiguous — **open every top-level reply with a reference marker** identifying the comment you are addressing. Cite the author and the opening of the original, and link it when the item includes a `url`:

```
> **Re:** @<author> — "<first line of the original, ~100 chars>…"
> <item `url`, if present>

<what changed, or why it's not an issue>

*— AI Coding Agent*
```

**Reply format (both cases):**

- 1-2 sentences: what was changed, why it's not an issue, or acknowledgment of declined items.
- End every reply with `\n\n*— AI Coding Agent*`.
- Before replying, dedupe against re-loops: for inline threads, check whether the thread already has a reply ending in `*- AI Coding Agent*` / `*— AI Coding Agent*`. For a top-level comment with a `comment_id`, the 🎉 reaction handles it — an item carrying `acknowledged: true` (bucketed as `resolved`) has already been answered, so skip it. For a `review_summary` with no `comment_id`, fall back to the reference-marker scan.
- If the `gh`/GraphQL call fails, log and continue — do not block the workflow.

### 4. Check CI Status

Run `${CLAUDE_SKILL_ROOT}/scripts/fetch_pr_checks.py` to get structured failure data.

**Wait if pending:** If review bot checks (sentry, warden, cursor, bugbot, seer, codeql) are still running, wait before proceeding—they post actionable feedback that must be evaluated. Informational bots (codecov) are not worth waiting for.

#### Stacked PRs: ignore the OpenSpec Archive Check unless this is the last PR in the chain

The `PR OpenSpec Archive Check` (workflow `pr-check-openspec.yml`) fails whenever
any unarchived directory exists under `openspec/changes/`. A change is archived
exactly once, at the END of the work — so a PR that still carries an in-progress
change directory will fail this check. Archiving on an intermediate PR is wrong:
it would remove the change docs before the implementation PRs above it merge.

Note the workflow's trigger is currently `pull_request.branches: [main]`, so it
only RUNS on PRs whose base is `main`. A stacked PR based on another feature
branch won't run (or fail) this check at all — so there is nothing to ignore
there. The check matters for PRs that target `main`: typically the bottom of a
stack, plus any PR later retargeted to `main` as the stack merges down.

When the archive check does run and fail, decide ONE thing before treating it as
actionable: **is this PR the last in the chain (the tip)?** A PR is the tip when
no other OPEN PR targets its head branch as a base:

```bash
HEAD=$(gh pr view --json headRefName --jq '.headRefName')
gh pr list --state open --base "$HEAD" --json number
```

An empty list → nothing is stacked on top → this PR is the tip.

Then:

- **Not the tip** (some open PR is stacked on this one) → IGNORE the
  `PR OpenSpec Archive Check` failure. Do NOT archive the change on this PR.
  Treat the check as expected-red and do not let it block the iterate loop
  (still address every other failing check and all feedback normally).
- **The tip** (nothing stacked on top — including an ordinary standalone PR) →
  the change MUST be archived before merge. Archive it via the OpenSpec archive
  flow, which moves `openspec/changes/<name>/` to the dated archive directory
  `openspec/changes/archive/YYYY-MM-DD-<name>/` (do not invent a different
  location), then commit and push so the check goes green.

This rule applies ONLY to the OpenSpec Archive Check. Every other check is
handled normally regardless of stack position.

### 5. Fix CI Failures

For each failure in the script output:

1. Read the `log_snippet` and trace backwards from the error to understand WHY it failed — not just what failed
2. Read the relevant code and check for related issues (e.g., if a type error in one call site, check other call sites)
3. Fix the root cause with minimal, targeted changes
4. Find existing tests for the affected code and run them. If the fix introduces behavior not covered by existing tests, extend them to cover it (add a test case, not a whole new test file)

Do NOT assume what failed based on check name alone—always read the logs. Do NOT "quick fix and hope" — understand the failure thoroughly before changing code.

### 6. Verify Locally, Then Commit and Push

Before committing, verify your fixes locally:

- If you fixed a test failure: re-run that specific test locally
- If you fixed a lint/type error: re-run the linter or type checker on affected files
- For any code fix: run existing tests covering the changed code

If local verification fails, fix before proceeding — do not push known-broken code.

```bash
git add <files>
git commit -m "fix: <descriptive message>"
git push
```

### 7. Monitor CI and Address Feedback

Poll CI status and review feedback in a loop instead of blocking:

1. Run `uv run ${CLAUDE_SKILL_ROOT}/scripts/fetch_pr_checks.py` to get current CI status
2. If all checks passed → proceed to exit conditions
3. If any checks failed (none pending) → return to step 5
4. If checks are still pending:
   a. Run `uv run ${CLAUDE_SKILL_ROOT}/scripts/fetch_pr_feedback.py` for new review feedback
   b. Address any new high/medium feedback immediately (same as step 3)
   c. If changes were needed, commit and push (this restarts CI), then continue polling
   d. Sleep 30 seconds, then repeat from sub-step 1
5. After all checks pass, do a final feedback check: `sleep 10`, then run `uv run ${CLAUDE_SKILL_ROOT}/scripts/fetch_pr_feedback.py`. Address any new high/medium feedback — if changes are needed, return to step 6.

### 8. Repeat

If step 7 required code changes (from new feedback after CI passed), return to step 2 for a fresh cycle. CI failures during monitoring are already handled within step 7's polling loop.

## Exit Conditions

Before exiting, check `summary.pending_reviewers`. If it is > 0, reviewers have been requested but haven't submitted yet — their review may produce new feedback. Ask the user whether to wait:

- **Yes:** sleep 30 seconds, re-check feedback. If new high/medium feedback appeared, address it (return to step 3). If `pending_reviewers` dropped to 0, proceed to exit. Repeat until reviewers complete.
- **No:** proceed to the exit conditions below.

If waiting produced code changes, return to step 2 for a fresh cycle.

**Success:** All checks pass, post-CI feedback re-check is clean (no new unaddressed high/medium feedback including review bot findings), user has decided on low-priority items, and pending reviewers resolved or user opted to skip.

**Ask for help:** Same failure after 2 attempts, feedback needs clarification, infrastructure issues.

**Stop:** No PR exists, branch needs rebase.

## Fallback

If scripts fail, use `gh` CLI directly:

- `gh pr checks name,state,bucket,link`
- `gh run view <run-id> --log-failed`
- `gh api repos/{owner}/{repo}/pulls/{number}/comments`
