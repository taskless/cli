## Code Standards

When creating or modifying files, you **MUST** follow these conventions:

- Code Style Guide @.conventions/STYLEGUIDE-CODE.md
- UI Conventions @.conventions/STYLEGUIDE-UI.md
- When a user asks about what you can do, you _should_ suggest actions from this CLAUDE.md file.
- **NEVER** read a `.dev.vars` or `.env` or `.secrets` file

## Code Quality Checks

**IMPORTANT** After making code changes, you **MUST** run the checks specified in @.conventions/STYLEGUIDE-CODE.md

## Local Development

When running Taskless CLI commands in this repo, use `pnpm cli` instead of `pnpm dlx @taskless/cli@latest`. This runs the locally built CLI at `./packages/cli/dist/index.js`.

**`pnpm cli` runs the last build, not the working tree.** `dist/` is a build artifact and nothing rebuilds it for you, so a stale `dist/` serves stale behavior, including stale `agent <topic>` recipes, which are embedded into the bundle at build time rather than fetched over the network. Run `pnpm build` first whenever the answer depends on current source.

This is not hypothetical. An agent followed `pnpm cli agent create-sg-rule` from a `dist/` built 26 commits earlier and got topic **v2** while HEAD served **v3**. The revision it missed was the one documenting that `language:` takes ast-grep's own spelling, so four new rules were authored with an off-list lowercase `typescript`. That one happened to reach the right parser. A name ast-grep does not recognize at all aborts config parsing and takes every other rule's report down with it, silently.

**The installed Taskless skill pins a published nightly**, recorded as `install.cliVersion` in `.taskless/taskless.json`, and every command in `.taskless/skills/taskless/SKILL.md` carries that pin. The pin and `pnpm cli` disagree exactly when `dist/` is behind HEAD, and neither is automatically right: the pin is a real build of some commit, `pnpm cli` is this tree only after you rebuild it. Rebuild, then prefer `pnpm cli`: it is the only one that can reflect uncommitted work. Note that the nightly package is blocked by a deny rule here, so `pnpm build` is the practical way to get current recipes, not a fallback.

When running OpenSpec commands in this repo, use `pnpm openspec` instead of a bare `openspec`. The bare command is not on `PATH` here and is blocked by a deny rule.

## Git Command Help for Agents

- **ALWAYS** run `git commit` with the `-S` flag to ensure commits are GPG-signed. If signing fails, prompt the user to run `echo "test" | gpg --sign > /dev/null` to load their GPG signing key, then retry the commit.

- **ALWAYS** prefer local directory paths when running git commands. For example, run `git status` from the repo root instead of `git -C /path/to/repo status`. This ensures that git's context is correct and avoids issues with submodules, worktrees, and nested repositories.

- **ALWAYS** wait for confirmation before committing. After staging changes with `git add`, present a summary and pause for user approval before running the commit. This allows the user to review diffs and catch issues early.

- **CHECK the clone is not shallow before rebasing or force-pushing.** A `git clone --depth=N` also implies `--single-branch`, which leaves the clone unable to do ordinary branch work:

  ```bash
  git rev-parse --is-shallow-repository   # must be false
  git config --get-all remote.origin.fetch # must be +refs/heads/*:refs/remotes/origin/*
  ```

  If either is wrong, repair it once. Both are local settings, nothing is committed:

  ```bash
  git fetch --unshallow
  git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
  git fetch origin
  ```

  Until then: `--force-with-lease` fails with `stale info` on every branch (there is no remote-tracking ref to lease against, so people fall back to a bare `--force`), `git push -u` cannot store an upstream, `gh pr create` needs an explicit `--head <branch>`, and `git branch -r` shows only `main`. The dangerous one is quieter. `git rebase main` is only correct while the merge base sits inside the shallow window, so as `main` advances a rebase can reconstruct the wrong base without saying so.

## PR Issue References

Reference issues as a **trailing line at the bottom of the PR body**, not inline in the opening paragraph:

| Syntax                | Effect                          |
| --------------------- | ------------------------------- |
| `Fixes #1234`         | Closes GitHub issue on merge    |
| `Fixes TSKL-1234`     | Closes Taskless Linear issue    |
| `Fixes OSS-123`       | Closes an OSS-team Linear issue |
| `Refs GH-1234`        | Links without closing           |
| `Refs LINEAR-ABC-123` | Links Linear issue              |

- A bare `<TEAM>-NNN` resolves without a URL for **any** Linear team, not just `TSKL-`. `TSKL-` is Product and `OSS-` is the open-source team; verified with `OSS-23`, which the integration linked and moved to In Review on PR creation.
- `Fixes` for the issue this PR resolves; `Refs` for a parent or related issue that stays open.
- Mentioning an issue in prose (`Found while investigating TSKL-5678.`) is **not** a reference: a PR can cite an issue mid-body with no trailing directive at all.
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

- **A worktree gets its own empty `node_modules`.** `git worktree add` is not finished until `pnpm install` has run inside it. Without that, `git commit` fails in `lint-staged` (no `prettier`/`eslint`), and every `pnpm` script fails. A missing `prettier` here once cost an agent an hour of dead-end workarounds. There is no `pnpm worktree` command; `git worktree` is the tool.
- **NEVER point an agent at the main repo path** (e.g. `/Users/<you>/code/taskless/skills`). It will `cd` there and run git commands and edits in the **main** checkout, defeating isolation. It can create and check out a branch in your working tree, silently switching your session off its own branch. Tell the agent to work in **its assigned worktree** (`$PWD`) and pass only relative paths plus GitHub identifiers (`owner/repo`).

## Stacked PRs

When PRs stack, the **stack-breadcrumb workflow** (`.github/workflows/stack-breadcrumb.yml`) keeps their cross-links and carried-forward bodies in sync automatically; there is no git-town or other stacking tool in the loop. Branch protection lives on `main` only (`Validate` required, `strict_up_to_date: true`, 0 required reviews); child branches are unprotected. When you do land a stack, follow these practices.

### Every OpenSpec proposal declares its delivery shape

The proposal states which of these the change is, and why. Decide it while writing the proposal, not when the diff has already grown too big to review.

| Shape                        | When                                                                                                         | How it lands                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single PR**                | The whole change fits one reviewable diff.                                                                   | Spec, implementation, and the archive land together.                                                                                                |
| **Stacked, merging forward** | Each unit is independently safe in production.                                                               | Each PR merges to `main` in turn; the last one archives the change.                                                                                 |
| **Stacked, merging down**    | The units are only correct together, and an intermediate state would ship a broken or half-migrated product. | Merge each PR **down** into its parent from the tip, then one protected merge of the bottom branch to `main`. The change reaches `main` atomically. |

**Prefer stacking, and aim to keep an individual diff under ~1200 lines of hand-written change.** A PR far past that does not get reviewed, it gets approved. Generated files (lockfiles, regenerated schemas, vendored artifacts) do not count toward the total, since a reviewer does not read them. Tests and OpenSpec artifacts do count, but never split from the change they describe. The number is set so that a task change, its implementation, and its tests fit together comfortably, rather than forcing a split along the seam the rest of this guidance tells you not to cut. A diff well past this is not automatically wrong, but it should come with a reason.

The deciding question between forward and down is only this: **can each unit reach production on its own without breaking anything?** If landing unit 1 alone would leave `check` broken, tests failing, or a migration half-applied, the answer is no and the stack merges down. Do not assume forward because it is tidier. Verify it, since "each unit is safe" is a claim about behavior, not intent.

Note how this interacts with archiving: a change is archived exactly once, on whichever PR is the tip. **No check asks about that anywhere any more.** A PR-time gate could only guess at stack position, and guessed wrong often enough to be ignored; a `main`-only gate replaced it and turned `main` red for the entire time a forward-merging stack was draining, which is a red that means "work is in progress" rather than "something is wrong". A signal that is expected to be red is not a signal. Archiving is now a step you perform on the tip, and the thing worth detecting (work that stalled and was abandoned) is not what either gate measured.

### One changeset, at the bottom of the stack, grown as the stack grows

`changeset.yml` looks for a `.changeset/*.md` added or modified **anywhere between `main` and the PR's head**, meaning the whole stack, since a child branch contains its ancestors' commits. It **warns and never fails**: a missing changeset is a judgement call about whether the change ships a release note, and the workflow is not in a position to make it.

That is a deliberate retreat from a gate. A per-PR requirement had to reason about stack position to tell a real omission from a file that merely lives further down, and the `skip-changeset` label ended up being applied to silence a red check rather than to record "this ships no release note." The label survives, but it now suppresses a warning, so it can no longer be used to force a merge through.

The placement rules are unchanged, because they are about review quality rather than about passing a check:

- **The changeset belongs on the bottom PR**, the one that targets `main`. It is the first branch every other one inherits from, and the one that carries the release note to `main` if the stack lands forward.
- **Never add a second changeset per PR.** One change ships once and gets one release note; a later PR extends the existing file.

### `branches:` filters do not tell you where a workflow runs

**`branches: [main]` does not reliably mean either "only the PR whose base is `main`" or "every PR in the stack."** The filter matches the PR's base ref, but GitHub also resolves a stacked PR's _eventual_ target and sometimes matches on that instead, so a filtered workflow runs on mid-stack PRs. Observed on #73, #80, and #81, all with `openspec/partition-engine-*` bases.

**Do not depend on that resolution. It is undocumented and it stops without warning.** On the #71→#93→#94→#95→#100→#102→#103→#106 stack, every PR up to #102 got a `Validate` run and **#103 and #106 got none**, across 16 `pull_request` events that filter-less workflows handled fine. #103 was a ~93-file change that reached "ready for review" having never been linted, typechecked, or tested in CI. Depth correlates (#102 is six hops from `main`, #103 seven) but nothing confirms a cap, and it was not a date cutoff: #102 kept getting runs after #103 had already stopped. A filter that works for six PRs and quietly fails on the seventh is worse than one that never worked, because nobody re-checks it.

Two rules follow, and they pull in opposite directions:

- **A workflow that must run everywhere carries no `branches:` filter at all.** Lint, typecheck, and tests have no interest in where a PR eventually merges. `validate.yml`, `changeset.yml`, and `stack-breadcrumb.yml` all carry no filter, which is why they kept running on #103. If you add such a workflow, also name `ready_for_review` in `types:`. It is not in the default set (`opened`/`synchronize`/`reopened`), so without it a draft marked ready gets no fresh run until someone happens to push again.
- **A workflow whose correctness depends on "is this the PR that merges to `main`" must determine that itself**, from the base ref or by resolving stack position, and cannot lean on the `on:` filter to scope it. Better still, ask a question that does not depend on stack position at all: `changeset.yml` diffs against `main` rather than against its base. The archive check tried the other route, moving off pull requests onto `main`, and was removed instead, because on `main` it reported an in-flight stack as a fault.

The shared point: the `on:` filter is not a reliable answer to "where does this PR land." Let the workflow run, and decide inside it.

### Growing the changeset

Put the changeset at the base and every branch above inherits it, since a child contains its ancestors' commits.

**Write it on the base branch before you cut the children.** Inheritance only runs forward in time: a child branched before the file existed does not carry it, and "grown as the stack grows" has nothing to grow. What makes this easy to miss is that the natural moment to write a release note is when you finish a unit, which is exactly the moment you are standing on a child branch, several branches above the base. A changeset stranded on the tip still reaches `main` when a stack merges down, but on a forward-merging stack it means every PR below it lands with no release note.

**Grow it incrementally when the stack merges forward.** Each PR extends the changeset with its own scope rather than the base describing the whole future change up front. A reviewer reading the changeset then sees only what has actually landed, and is not asked to evaluate a release note that promises more than the diff in front of them. When you extend it, edit the same file on the branch you are working on. Never add a second changeset per PR, or one change becomes several release notes for what merges to `main` exactly once.

**When the stack merges down, that reasoning does not apply.** Nothing reaches `main` until everything does (a single protected merge carries the whole stack), so a changeset describing the complete change is accurate at the only moment it is ever read, and no reviewer is asked to approve more than what lands. Growing it per unit is still friendlier to review, but there it is a preference, not a correctness constraint.

In both shapes the file belongs **on the bottom branch**. Nothing enforces that any more, so it is on you: a forward-merging stack publishes from `main` as each slice lands, and only a changeset that is already there gets read.

### Landing a stack: merge _down_, then one merge to `main`

Merge each PR **down** into its parent's branch, from the tip to the bottom:

- Merge `#tip` into its parent's branch, then that into the next parent, … down to the bottom branch (which targets `main`). The bottom branch accumulates the whole stack.
- Bring the bottom branch up to date with `main`, let `Validate` pass, then do the **single** protected merge to `main`.
- Result: one CI cycle instead of N, and every PR gets a real **Merged** badge (not "closed/absorbed").

**Merge the down-merges one at a time, not in a loop.** Merging a child immediately invalidates the parent PR's mergeability until GitHub recomputes: `gh pr merge` fails with "Pull Request is not mergeable", and the API reports `rebaseable: null`. In a tight loop this makes merges land **out of order**, which strands the tip's commits part-way down the stack (e.g. `skill`/`eval` never propagate past `help`). Merge each PR, wait for the next to report a boolean `rebaseable`, then continue.

**Verify by content, not by ancestry.** Rebase-and-merge replays commits under new SHAs, so the tip's original commits are never ancestors of the branch that absorbed them, and the obvious check reports a false `STRANDED`:

```bash
# WRONG under rebase-and-merge — fails even when everything landed
git merge-base --is-ancestor origin/<tip-branch> origin/<bottom-branch>

# Right: ask whether the content differs
git diff --stat origin/<bottom-branch> origin/<tip-branch>   # empty = fully absorbed
```

An empty diff with differing SHAs is the _expected_ healthy state after a rebase merge, not evidence of a problem. If the diff is genuinely non-empty, reconcile from the tip (a tip branch contains the whole stack), then re-check the diff and push.

### Never `--delete-branch` mid-stack

`gh pr merge <n> --delete-branch` on a stacked PR **closes the child** PR (its base branch vanishes) instead of retargeting it. Leave branches in place during the stack; clean them up only after the whole stack has landed.

### Rebase is the only merge method, and a stack pays for it

`main` keeps a linear history, so the repository allows **rebase-and-merge only**; squash and merge-commit are both disabled. Confirm rather than assume, since this changed:

```bash
gh api repos/{owner}/{repo} --jq '"squash=\(.allow_squash_merge) merge=\(.allow_merge_commit) rebase=\(.allow_rebase_merge)"'
# squash=false merge=false rebase=true
```

`gh pr merge --merge` and `--squash` both fail. Use `gh pr merge <n> --rebase`.

**This is the expensive case for a stack, and there is no cheaper option available.** Rebase-and-merge replays the branch onto `main` as _new commits with new SHAs_. Every child then contains the pre-rebase versions of its ancestors' commits, so the child is not merely behind: its history diverged. After each merge you must rebase the next branch onto the updated `main` and force-push it. The old guidance to prefer merge-commits so children stay clean no longer applies; that door is closed.

Practically, landing a stack now looks like:

```bash
gh pr merge <bottom> --repo <owner>/<repo> --rebase
git fetch origin
git rebase -S origin/main            # in the next branch's worktree
git push origin --force-with-lease=<branch>:$(git rev-parse origin/<branch>) <branch>
```

Three things that will bite:

- **Branch protection is `strict_up_to_date: true`,** so the next PR reports `mergeable_state: "behind"` until you rebase it. That is not a conflict; it is the protection asking for the rebase you owe it.
- **Right after a merge, `rebaseable` reads `null`** while GitHub recomputes. Poll until it is a boolean rather than treating `null` as "not mergeable". Reading it as a failure is what stranded commits mid-stack before.
- **Read the lease SHA from the remote, not from memory.** `--force-with-lease=<branch>:<sha>` fails with `stale info` when `<sha>` is not what the remote currently holds, which includes the case where _you_ rebased the branch a moment ago and reached for its old tip. `$(git rev-parse origin/<branch>)` after a `git fetch` is the value that works. The failure looks like the shallow-clone symptom in the git section above and is not: check whether the SHA is just out of date before concluding anything about the clone.

### Rebase-and-merge lands unsigned commits on `main`

Commits are signed locally (`git commit -S`, mandatory above), but **GitHub rewrites them when it rebases, and does not re-sign.** Every commit on `main` reports `N`:

```bash
git log --format='%G? %h %s' -5 origin/main   # N, N, N, …
```

Nothing is wrong and nothing needs fixing on `main`. Know it so that `%G?` on a merged commit is not mistaken for a signing failure, and so a fresh commit reading `N` **before** it reaches `main` is recognised as the real problem it is: that one means `-S` was missed.

### Recovery if a child PR gets closed by base-branch deletion

This happens when the **parent** PR is merged with `--delete-branch`: deleting the parent's head branch (which is the child's base) closes the **child** PR. Two PRs are involved, the merged parent (`<parent>`) and the closed child (`<child>`); `<branch>` is the deleted base, i.e. the parent's head branch.

1. Restore the deleted base branch from **GitHub's own copy of the parent's head**, `refs/pull/<parent>/head`. GitHub keeps that ref after the branch is deleted and after the PR is merged, and it points at the pre-merge tip:

   ```bash
   SHA=$(git ls-remote origin "refs/pull/<parent>/head" | cut -f1)
   gh api --method POST repos/<owner>/<repo>/git/refs -f ref=refs/heads/<branch> -f sha="$SHA"
   ```

   **Do not reach for the merge commit's second parent.** The older form here was:

   ```bash
   git rev-parse "$MERGE_SHA^2"   # WRONG under rebase-and-merge
   ```

   `^2` needs the merge commit to _have_ two parents, which is true only of a merge-commit merge. Rebase replays the branch as linear single-parent commits, so `^2` fails with "unknown revision", and this repository is rebase-only, so it fails always. `refs/pull/<n>/head` is correct under every merge method, which is the better reason to prefer it.

   Take the ref from `<parent>`, the PR that actually merged, not from the closed child, whose head is a different branch.

2. Reopen the child via **REST** (GraphQL `gh pr reopen` fails on the Projects-classic deprecation):
   `gh api --method PATCH repos/<owner>/<repo>/pulls/<child> -f state=open`
3. Retarget it: `gh pr edit <child> --base main` (only works once it's open).

### Other gotchas

- **Projects-classic deprecation** breaks some GraphQL-backed `gh` commands (e.g. `gh pr reopen`). Workaround: use the REST API for PR state changes (`gh api --method PATCH .../pulls/<n> -f state=open`).
- **`gh pr update-branch` may not exist** in the installed `gh`; update locally (`git merge origin/main` on the up-to-date remote branch) and push.
- **No OpenSpec archive check at all.** An unarchived change directory is expected on a pull request AND on `main` while a forward-merging stack drains. Neither is a failure, and nothing reports it. Archive the change on the tip slice; a replacement that measures abandoned work rather than in-progress work is a separate piece of design.
- **Clean up local branches** once the stack lands: `git fetch --prune`, then delete the branches that merged (`git branch --merged main`).

## OpenSpec Apply

When implementing changes via `/opsx:apply`, **pause after each task group** for user review before continuing. Commit between groups and wait for confirmation.
