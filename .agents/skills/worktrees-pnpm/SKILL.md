---
name: worktrees-pnpm
description: Create and work in git worktrees in this pnpm workspace. Use when creating a worktree, delegating to a background agent with worktree isolation, or when a worktree fails at commit time with a missing prettier/eslint/tsx binary. Covers why a worktree needs its own pnpm install, and why worktrees live beside the repo rather than inside it.
---

# Worktrees in a pnpm workspace

A git worktree is a second checkout of this repository sharing one `.git`. It gets its own
working tree — and **its own empty `node_modules`**. That single fact causes every worktree
problem in this repo.

## The rule

**`git worktree add` is not finished until `pnpm install` has run inside the new worktree.**

```bash
git worktree add ../skills-worktrees/<name> <branch>   # or -b <branch> for a new one
cd ../skills-worktrees/<name>
pnpm install            # ← not optional
```

Worktrees go **beside the repo**, in `../skills-worktrees/`, never inside it. Agent worktrees land there too: the `WorktreeCreate` / `WorktreeRemove` hooks in `.claude/settings.json` (scripts under `.claude/hooks/`) replace the default placement, which would otherwise nest them at `.claude/worktrees/<id>`.

That is not a matter of taste. A worktree is a complete second checkout, so nesting it inside the repo means every tool that walks the tree from the root walks into it. We hit exactly that: a root `eslint .` traversed 2983 files across two agent worktrees and failed on code an agent had half-written. An ignore rule patches one tool; a sibling directory makes the whole class of problem impossible. One directory also answers "what worktrees do I have?" at a glance — `ls ../skills-worktrees/`.

A branch can only be checked out in one worktree at a time. If the branch you want is checked out in the primary tree, move that tree to another branch first.

Skipping the install leaves a checkout that looks fine and fails the moment you try to
accomplish anything:

- **`git commit` fails or silently skips checks.** Commits run `lint-staged`, which shells out
  to `prettier` and `eslint` from `node_modules/.bin`. Neither exists in a fresh worktree.
- **`pnpm typecheck` / `lint` / `test` fail** — no `typescript`, no `vitest`, no `vite`.
- **`pnpm openspec` fails** — the binary is not on `PATH` in this repo; it resolves through
  `node_modules`.
- **`tsx` scripts fail**, including the CLI's own build and schema-generation scripts.

This has cost real time before: an agent working in a worktree without `node_modules` spent
roughly an hour building workarounds for a missing `prettier` rather than running `pnpm install`.

## There is no `pnpm worktree` command

pnpm does not provide worktree subcommands. Use `git worktree` — it is the correct tool.
(pnpm's own repository has a `worktree:new` helper script, but that is a script in _their_
repo, not a pnpm feature. Do not go looking for it here.)

pnpm's only contribution here is the install you owe the new worktree.

## What the install actually costs

`du` reports `node_modules` at roughly 370 MB, but that is apparent size. The pnpm store lives
on the same APFS volume, so package content is shared by copy-on-write rather than duplicated;
the real incremental cost of another worktree is far smaller than the number suggests. Disk is
not the reason to avoid a worktree.

**`enableGlobalVirtualStore` is not used here, and that is settled.** It would make installs a
tree of symlinks into one shared store, but it is experimental, pnpm documents it as not working
with ESM under hoisted dependencies, and this repo is ESM throughout. We gain nothing worth that
risk. Do not re-propose it.

So a worktree install is a normal install. Budget for it; do not skip it.

## The in-repo ignore is a backstop, not the mechanism

`eslint.config.js` still ignores `.claude/worktrees/`, and `.gitignore` still lists it. With the
hooks in place nothing should land there — the ignores exist so that a worktree created by hand
in the old location, or by a tool that bypasses the hooks, cannot silently break a root lint.
Cheap insurance against a failure that is otherwise invisible.

Verified as unaffected by nesting either way: prettier (its globs do not descend into
dot-directories) and `tsc` (typecheck runs per-package through turbo, not from the root).

## Delegating to a background agent with worktree isolation

- **Never point the agent at the main repo path.** Given an absolute path to the primary
  checkout, an agent will `cd` there and run its git commands and edits in _your_ working
  tree — creating and checking out branches under you, silently moving your session off its
  own branch. Tell the agent to work in **its assigned worktree** (`$PWD`) and pass only
  relative paths plus GitHub identifiers (`owner/repo`).
- **Tell it to run `pnpm install` first**, or it will hit the failures above at commit time,
  which is the worst moment to discover them.
- **If it needs a tool and cannot install**, it can invoke the main checkout's binaries against
  the worktree's files — but prefer installing.
- **If the agent stalls in a degraded shell** (every command taking minutes), stop it
  (`TaskStop`) and finish the work directly rather than waiting it out. Check its scratchpad
  first for artifacts it already produced.

## Cleaning up

```bash
git worktree remove ../skills-worktrees/<name>   # add --force if it has uncommitted changes
git worktree list                                 # confirm
```

Removing the directory by hand leaves a stale registration; `git worktree prune` clears it.

To relocate an existing worktree, use `git worktree move <from> <to>` — it rewrites the `.git`
pointers, and `node_modules` comes along, so no reinstall is needed. Moving the directory
yourself leaves the worktree pointing at a path that no longer exists.

## Recovery: the main checkout got switched onto an agent's branch

Your work is safe as long as it was pushed — confirm `origin/<branch>` and the PR head SHA
still match your last commit. Then:

```bash
git worktree remove --force <path>
git branch -D <stray-branch>
git checkout <your-branch>
```

## When a worktree is worth it

Worktrees cost a `pnpm install` and a little wall-clock. They earn it
when you need two branches checked out at once — running a long test suite on one branch while
editing another, or letting a background agent work without disturbing your tree.

For sequential work on several branches, plain `git checkout` in one checkout is cheaper and
has none of these failure modes.
