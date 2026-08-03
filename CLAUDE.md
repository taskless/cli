## Code Standards

When creating or modifying files, you **MUST** follow these conventions:

- File Naming Conventions @.claude/FILE-CONVENTIONS.md
- Code Style Guide @.claude/STYLEGUIDE-CODE.md
- UI Conventions @.claude/STYLEGUIDE-UI.md
- When a user asks about what you can do, you _should_ suggest actions from this CLAUDE.md file.
- **NEVER** read a `.dev.vars` or `.env` or `.secrets` file

## Code Quality Checks

**IMPORTANT** After making code changes, you **MUST** run the checks specified in @.conventions/STYLEGUIDE-CODE.md

## Local Development

When running Taskless CLI commands in this repo, use `pnpm cli` instead of `pnpm dlx @taskless/cli@latest`. This runs the locally built CLI at `./packages/cli/dist/index.js`.

When running OpenSpec commands in this repo, use `pnpm openspec` instead of a bare `openspec`. The bare command is not on `PATH` here and is blocked by a deny rule.

## Git Command Help for Agents

- **ALWAYS** run `git commit` with the `-S` flag to ensure commits are GPG-signed. If signing fails, prompt the user to run `echo "test" | gpg --sign > /dev/null` to load their GPG signing key, then retry the commit.

- **ALWAYS** prefer local directory paths when running git commands. For example, run `git status` from the repo root instead of `git -C /path/to/repo status`. This ensures that git's context is correct and avoids issues with submodules, worktrees, and nested repositories.

- **ALWAYS** wait for confirmation before committing. After staging changes with `git add`, present a summary and pause for user approval before running the commit. This allows the user to review diffs and catch issues early.

## PR Issue References

Reference issues as a **trailing line at the bottom of the PR body**, not inline in the opening paragraph:

| Syntax                | Effect                       |
| --------------------- | ---------------------------- |
| `Fixes #1234`         | Closes GitHub issue on merge |
| `Fixes TSKL-1234`     | Closes Taskless Linear issue |
| `Refs GH-1234`        | Links without closing        |
| `Refs LINEAR-ABC-123` | Links Linear issue           |

- `TSKL-` is the Taskless Linear team prefix; a bare `TSKL-NNNN` resolves without a URL.
- `Fixes` for the issue this PR resolves; `Refs` for a parent or related issue that stays open.
- Mentioning an issue in prose (`Found while investigating TSKL-5678.`) is **not** a reference — a PR can cite an issue mid-body with no trailing directive at all.
- Only use a reference you can verify from user input, the branch name, commits, PR discussion, or tracker output. Never invent an issue number.

### Editing an existing PR

`gh pr edit` is broken by GitHub's Projects (classic) deprecation. Use `gh api` for body and title updates:

```bash
gh api -X PATCH repos/{owner}/{repo}/pulls/PR_NUMBER -f body="$(cat <<'EOF'
Updated description here
EOF
)"

gh api -X PATCH repos/{owner}/{repo}/pulls/PR_NUMBER -f title='new: Title here'
```

Both flags can be passed in one call. See also **Stacked PRs → Other gotchas** for the PR-state equivalent.

## Background Agents and Worktrees

**Use the `worktrees-pnpm` skill** whenever creating a worktree or delegating to a background agent with worktree isolation. It covers the full procedure, the pnpm specifics, cleanup, and recovery.

The two rules that cause the most damage when missed:

- **A worktree gets its own empty `node_modules`.** `git worktree add` is not finished until `pnpm install` has run inside it. Without that, `git commit` fails in `lint-staged` (no `prettier`/`eslint`), and every `pnpm` script fails. A missing `prettier` here once cost an agent an hour of dead-end workarounds. There is no `pnpm worktree` command — `git worktree` is the tool.
- **NEVER point an agent at the main repo path** (e.g. `/Users/<you>/code/taskless/skills`). It will `cd` there and run git commands and edits in the **main** checkout, defeating isolation — it can create and check out a branch in your working tree, silently switching your session off its own branch. Tell the agent to work in **its assigned worktree** (`$PWD`) and pass only relative paths plus GitHub identifiers (`owner/repo`).

## Stacked PRs

When PRs stack, the **stack-breadcrumb workflow** (`.github/workflows/stack-breadcrumb.yml`) keeps their cross-links and carried-forward bodies in sync automatically; there is no git-town or other stacking tool in the loop. Branch protection lives on `main` only (`Validate` required, `strict_up_to_date: true`, 0 required reviews); child branches are unprotected. When you do land a stack, follow these practices.

### Every OpenSpec proposal declares its delivery shape

The proposal states which of these the change is, and why. Decide it while writing the proposal, not when the diff has already grown too big to review.

| Shape                        | When                                                                                                      | How it lands                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single PR**                | The whole change fits one reviewable diff.                                                                | Spec, implementation, and the archive land together.                                                                                                |
| **Stacked, merging forward** | Each unit is independently safe in production.                                                            | Each PR merges to `main` in turn; the last one archives the change.                                                                                 |
| **Stacked, merging down**    | The units are only correct together — an intermediate state would ship a broken or half-migrated product. | Merge each PR **down** into its parent from the tip, then one protected merge of the bottom branch to `main`. The change reaches `main` atomically. |

**Prefer stacking, and aim to keep an individual diff under ~300 lines.** A 900-line PR does not get reviewed, it gets approved. Tests count toward the total but never split from the code they cover — if a unit is oversized because of its tests, that is usually a sign the unit itself should be smaller.

The deciding question between forward and down is only this: **can each unit reach production on its own without breaking anything?** If landing unit 1 alone would leave `check` broken, tests failing, or a migration half-applied, the answer is no and the stack merges down. Do not assume forward because it is tidier — verify it, since "each unit is safe" is a claim about behavior, not intent.

Note how this interacts with the archive gate (see the OpenSpec archive check below): a change is archived exactly once, on whichever PR is the tip. Mid-stack PRs are expected to carry an unarchived change directory and the gate skips them.

### One changeset, at the bottom of the stack, grown as the stack grows

`require-changeset.yml` looks for a `.changeset/*.md` **added in that PR's own diff**. On a stack that means:

- **The changeset belongs on the bottom PR**, the one that targets `main`. That is the only place it can live: a changeset added on the tip is invisible to the bottom PR's diff, so the check would fail on the PR that actually merges.
- **Mid-stack PRs bypass the check**, because the base branch is not `main`. They inherit the base's changeset rather than adding one, so there is nothing for the check to find. **Do not label them `skip-changeset`** — the label records a deliberate "this change ships no release note," which is false here, and the bypass already handles it.

The bypass is an in-step check on the base ref, and it is load-bearing. **`branches: [main]` no longer means "only the PR whose base is `main`."** Under GitHub's stacked-PR support, a PR in a stack is understood to target `main` eventually, so the filter matches on that eventual target and the workflow runs on mid-stack PRs as well — observed here on #73, #80, and #81, all with `openspec/partition-engine-*` bases.

The general rule that follows: **any workflow whose correctness depends on "is this the PR that merges to `main`" must determine that itself** — from the base ref, or by resolving stack position — and cannot lean on the `on:` filter to scope it. If you see a mid-stack PR failing this check, look at that guard rather than reaching for the label.

Put the changeset at the base and every branch above inherits it, since a child contains its ancestors' commits.

**Grow it incrementally as the stack lands.** Each PR extends the changeset with its own scope rather than the base describing the whole future change up front. A reviewer reading the changeset then sees only what has actually landed, and is not asked to evaluate a release note that promises more than the diff in front of them. When you extend it, edit the same file on the branch you are working on — never add a second changeset per PR, or one change becomes several release notes for what merges to `main` exactly once.

### Landing a stack: merge _down_, then one merge to `main`

Merge each PR **down** into its parent's branch, from the tip to the bottom:

- Merge `#tip` into its parent's branch, then that into the next parent, … down to the bottom branch (which targets `main`). The bottom branch accumulates the whole stack.
- Bring the bottom branch up to date with `main`, let `Validate` pass, then do the **single** protected merge to `main`.
- Result: one CI cycle instead of N, and every PR gets a real **Merged** badge (not "closed/absorbed").

**Merge the down-merges one at a time, not in a loop.** Merging a child immediately invalidates the parent PR's mergeability (`gh pr merge` fails with "Pull Request is not mergeable") until GitHub recomputes. In a tight loop this makes merges land **out of order**, which strands the tip's commits part-way down the stack (e.g. `skill`/`eval` never propagate past `help`). Merge each PR, wait a few seconds, confirm the next is `MERGEABLE`, then continue. After the down-merges, verify the bottom branch actually contains the tip before the final merge:

```bash
git merge-base --is-ancestor origin/<tip-branch> origin/<bottom-branch> && echo "OK" || echo "STRANDED"
```

If stranded, reconcile from the tip (a tip branch contains the entire stack): on the bottom branch, `git merge origin/main` then `git merge origin/<tip-branch>`, confirm the only diff vs. the tip is whatever landed on `main` separately, and push.

### Never `--delete-branch` mid-stack

`gh pr merge <n> --delete-branch` on a stacked PR **closes the child** PR (its base branch vanishes) instead of retargeting it. Leave branches in place during the stack; clean them up only after the whole stack has landed.

### Use merge-commit, not squash, for a stack

Stacked branches share commits (each child contains its ancestors). Prefer explicit `gh pr merge --merge` — `--merge` keeps children clean, while squash rewrites the parent into a new commit the children don't have, forcing a manual `git merge origin/main` reconciliation on every child between merges and inviting phantom conflicts.

### Recovery if a child PR gets closed by base-branch deletion

This happens when the **parent** PR is merged with `--delete-branch`: deleting the parent's head branch (which is the child's base) closes the **child** PR. Two PRs are involved — the merged parent (`<parent>`) and the closed child (`<child>`); `<branch>` is the deleted base, i.e. the parent's head branch.

1. Restore the deleted base branch ref at the **parent** merge commit's second parent (the deleted branch's pre-merge tip). Resolve the merge commit from `<parent>` — the PR that actually merged — **not** the closed child (it's unmerged, so its `mergeCommit` is `null` and `git rev-parse` would fail), and **not** `origin/main^2` (only that second parent while the parent merge is still `main`'s tip; any later merge, or a squash/rebase tip, makes it the wrong SHA):
   ```bash
   MERGE_SHA=$(gh pr view <parent> --repo <owner>/<repo> --json mergeCommit --jq .mergeCommit.oid)
   gh api --method POST repos/<owner>/<repo>/git/refs -f ref=refs/heads/<branch> -f sha=$(git rev-parse "$MERGE_SHA^2")
   ```
2. Reopen the child via **REST** (GraphQL `gh pr reopen` fails on the Projects-classic deprecation):
   `gh api --method PATCH repos/<owner>/<repo>/pulls/<child> -f state=open`
3. Retarget it: `gh pr edit <child> --base main` (only works once it's open).

### Other gotchas

- **Projects-classic deprecation** breaks some GraphQL-backed `gh` commands (e.g. `gh pr reopen`). Workaround: use the REST API for PR state changes (`gh api --method PATCH .../pulls/<n> -f state=open`).
- **`gh pr update-branch` may not exist** in the installed `gh`; update locally (`git merge origin/main` on the up-to-date remote branch) and push.
- **Stack-aware OpenSpec archive check** (`pr-check-openspec.yml`) skips on non-tip PRs and runs on the tip; "tip" recomputes as branches merge, so it lands green when the archiving PR reaches `main`.
- **Clean up local branches** once the stack lands: `git fetch --prune`, then delete the branches that merged (`git branch --merged main`).

## OpenSpec Apply

When implementing changes via `/opsx:apply`, **pause after each task group** for user review before continuing. Commit between groups and wait for confirmation.
