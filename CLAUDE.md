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

When delegating to a background agent with **worktree isolation** (its own checked-out copy of the repo):

- **NEVER point the agent at the main repo path** (e.g. `/Users/<you>/code/taskless-skills`). It will `cd` there and run git commands and edits in the **main** checkout, defeating isolation — it can create and check out a branch in your working tree, silently switching your session off its own branch. Tell the agent to work in **its assigned worktree** (`$PWD`) and pass only relative paths plus GitHub identifiers (`owner/repo`).
- **The worktree has no `node_modules`** — `pnpm install` does not run there. An agent that needs `prettier`/`eslint`/`tsx` must invoke them from the main checkout's binaries against the worktree's files (or install first). A missing `prettier` here once cost an agent an hour of dead-end workarounds.
- **If a background agent stalls in a degraded shell** (each command taking minutes to return), stop it (`TaskStop`) and finish the work directly rather than waiting it out. Check its scratchpad first for artifacts it already produced (fetched files, partial output).

**Recovery if the main checkout gets switched onto an agent's branch:** your own work is safe as long as it was pushed — confirm `origin/<branch>` and the PR head SHA still match your last commit. Then `git worktree remove --force <path>`, delete the stray branch, and `git checkout <your-branch>`.

## Stacked PRs

Committing a branch straight to `main` is the norm — stacks are optional. When PRs _do_ stack, the **stack-breadcrumb workflow** (`.github/workflows/stack-breadcrumb.yml`) keeps their cross-links and carried-forward bodies in sync automatically; there is no git-town or other stacking tool in the loop. Branch protection lives on `main` only (`Validate` required, `strict_up_to_date: true`, 0 required reviews); child branches are unprotected. When you do land a stack, follow these practices.

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
