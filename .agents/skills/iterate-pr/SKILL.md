---
name: iterate-pr
description: Iterate on a PR until CI passes. Use when you need to fix CI failures, address review feedback, or continuously push fixes until all checks are green. Automates the feedback-fix-push-wait cycle.
---

# Iterate on PR Until CI Passes

Continuously iterate on the current branch until all CI checks pass and review feedback is addressed.

**Requires**: GitHub CLI (`gh`) authenticated.

**Important**: All scripts must be run from the repository root directory (where `.git` is located), not from the skill directory. Use the full path to the script via `${CLAUDE_SKILL_ROOT}`.

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
- `resolved` - Already resolved threads

Review bot feedback (from Sentry, Warden, Copilot, Cursor, Bugbot, CodeQL, etc.) appears in `high`/`medium`/`low` with `review_bot: true` — it is NOT placed in the `bot` bucket.

**Self-review feedback** (from the PR author) appears in `high`/`medium`/`low` with `self_review: true`. Because you can't "Request changes" on your own PR, a self-review lands as `COMMENTED` review summaries and ordinary review threads rather than changes-requested items — these are surfaced (not dropped) and bucketed by content, defaulting to `medium` when there's no `h:/m:/l:` prefix. Treat `self_review` items the same as any other human feedback in step 3.

Each feedback item may also include:

- `thread_id` - GraphQL node ID for inline review comments (used for replies)

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

**Top-level comments** (items WITHOUT a `thread_id` — `review_summary` items and top-level PR/issue comments, e.g. a review bot like Claude that posts its findings as one top-level comment):

There is no thread to reply into, so post a **new top-level comment** with `gh pr comment <pr> --body "..."`. A PR can carry several independent top-level comments, so a bare reply is ambiguous — **open every top-level reply with a reference marker** identifying the comment you are addressing. Cite the author and the opening of the original, and link it when the item includes a `url`:

```
> **Re:** @<author> — "<first line of the original, ~100 chars>…"
> <item `url`, if present>

<what changed, or why it's not an issue>

*— AI Coding Agent*
```

**Reply format (both cases):**

- 1-2 sentences: what was changed, why it's not an issue, or acknowledgment of declined items.
- End every reply with `\n\n*— AI Coding Agent*`.
- Before replying, dedupe against re-loops: for inline threads, check whether the thread already has a reply ending in `*- AI Coding Agent*` / `*— AI Coding Agent*`; for top-level comments, scan existing top-level comments for one whose **reference marker** already cites this author + snippet (the signature alone is not enough — distinct top-level items would otherwise collide).
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

**Success:** All checks pass, post-CI feedback re-check is clean (no new unaddressed high/medium feedback including review bot findings), user has decided on low-priority items.

**Ask for help:** Same failure after 2 attempts, feedback needs clarification, infrastructure issues.

**Stop:** No PR exists, branch needs rebase.

## Fallback

If scripts fail, use `gh` CLI directly:

- `gh pr checks name,state,bucket,link`
- `gh run view <run-id> --log-failed`
- `gh api repos/{owner}/{repo}/pulls/{number}/comments`
