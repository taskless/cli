---
name: worktrees-pnpm
description: Create and work in git worktrees in this pnpm workspace. Use when creating a worktree, delegating to a background agent with worktree isolation, or when a worktree fails at commit time with a missing prettier/eslint/tsx binary. Covers why a worktree needs its own pnpm install and how to make that install cheap.
---

# Worktrees in a pnpm workspace

A git worktree is a second checkout of this repository sharing one `.git`. It gets its own
working tree — and **its own empty `node_modules`**. That single fact causes every worktree
problem in this repo.

## The rule

**`git worktree add` is not finished until `pnpm install` has run inside the new worktree.**

```bash
git worktree add ../skills-<topic> -b <branch>
cd ../skills-<topic>
pnpm install            # ← not optional
```

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

What pnpm contributes is making the required install cheap; see below.

## Making the install cheap

`enableGlobalVirtualStore: true` in `pnpm-workspace.yaml` makes `node_modules` a tree of
symlinks into one content-addressable store shared across worktrees, so a second worktree's
`pnpm install` is close to instant instead of a full materialization.

It is **not currently enabled in this repo**, deliberately. Before turning it on, know:

- Requires pnpm ≥ **10.12.1** (this repo runs 10.12.4, so the version is fine).
- Defaults to `false`, and pnpm disables it automatically in detected CI.
- **It does not work with ESM when hoisted dependencies are used**, because Node no longer
  honours `NODE_PATH` in ESM. This repo is ESM (`packages/cli` is `"type": "module"`) and
  currently sets no hoisting configuration, so it is likely fine — but "likely" is why it is
  off. Enable it as its own change, with the full test suite as the check.
- The store assumes mutually trusting users and processes. Do not share one writable store
  across untrusted agents.

Until it is enabled, a worktree install is a normal install. Budget for it; do not skip it.

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
git worktree remove ../skills-<topic>     # add --force if it has uncommitted changes
git worktree list                          # confirm
```

Removing the directory by hand leaves a stale registration; `git worktree prune` clears it.

## Recovery: the main checkout got switched onto an agent's branch

Your work is safe as long as it was pushed — confirm `origin/<branch>` and the PR head SHA
still match your last commit. Then:

```bash
git worktree remove --force <path>
git branch -D <stray-branch>
git checkout <your-branch>
```

## When a worktree is worth it

Worktrees cost a full `node_modules` (until the global virtual store is enabled). They earn it
when you need two branches checked out at once — running a long test suite on one branch while
editing another, or letting a background agent work without disturbing your tree.

For sequential work on several branches, plain `git checkout` in one checkout is cheaper and
has none of these failure modes.
