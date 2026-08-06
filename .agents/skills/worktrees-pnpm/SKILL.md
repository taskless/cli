---
name: worktrees-pnpm
description: Create and work in git worktrees in this pnpm workspace. Use when creating a worktree, delegating to a background agent with worktree isolation, or when a worktree fails at commit time with a missing prettier/eslint/tsx binary. Covers why a worktree needs its own pnpm install, where worktrees live, and remediations for branch locks, moving a worktree, and failures that look like worktree problems but are not.
---

# Worktrees in a pnpm workspace

A git worktree is a second checkout of this repository sharing one `.git`. It gets its own
working tree — and **its own empty `node_modules`**. That single fact causes every worktree
problem in this repo.

## The rule

**`git worktree add` is not finished until `pnpm install` has run inside the new worktree.**

```bash
git worktree add worktrees/<name> <branch>   # or -b <branch> for a new one
cd worktrees/<name>
pnpm install            # ← not optional
```

Worktrees go in **`worktrees/` at the repo root**, gitignored. Agent worktrees land there too: the `WorktreeCreate` / `WorktreeRemove` hooks configured in `.claude/settings.json` (scripts in this skill's `scripts/` directory) replace the default placement, which would otherwise nest them at `.claude/worktrees/<id>`. `ls worktrees/` answers "what worktrees do I have?" at a glance.

A sibling directory (`../<repo>-worktrees/`) is the obvious alternative and was tried first. It is genuinely better on one axis — nothing inside the repo, so no tool can walk into it — but its path depends on what the clone directory is _named_, which committed config cannot know. A teammate whose checkout is not named the same thing gets permission prompts for every file operation, silently and per person. `worktrees/` is the same path in every clone; the price is the ignore entries in the next section, which are three lines you control.

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

## Setup (per repo)

This skill ships the hook scripts it needs, in `scripts/` beside this file. A repo that installs
the skill gets them; wiring them up is two edits.

**1. Register the hooks** in the repo's committed `.claude/settings.json`. `WorktreeCreate`
replaces the default placement logic entirely — it runs `git worktree add` itself and prints the
path it made — and `WorktreeRemove` is its counterpart.

```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR/.agents/skills/worktrees-pnpm/scripts/worktree-create.sh\"",
            "statusMessage": "Creating worktree"
          }
        ]
      }
    ],
    "WorktreeRemove": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR/.agents/skills/worktrees-pnpm/scripts/worktree-remove.sh\""
          }
        ]
      }
    ]
  }
}
```

Two things that will waste your time if you get them wrong. The **nested** `[{ "hooks": [...] }]`
shape is required — the flatter `[{ type, command }]` form shown on some documentation pages does
not validate, and an invalid settings file disables _every_ setting in it silently. And the
scripts need `jq` on `PATH`; they read their payload from stdin.

Verify without waiting for an agent, by feeding a hook its payload directly:

```bash
printf '{"hook_event_name":"WorktreeCreate","cwd":"%s","worktree_id":"probe"}' "$PWD" \
  | .agents/skills/worktrees-pnpm/scripts/worktree-create.sh
# expect: <repo>/worktrees/probe on stdout, git chatter on stderr, exit 0

# The id field is not stable across callers, so .worktreeId and .name are read
# too — `.name` is what a background agent's payload actually carries.
printf '{"hook_event_name":"WorktreeCreate","cwd":"%s","name":"probe-name"}' "$PWD" \
  | .agents/skills/worktrees-pnpm/scripts/worktree-create.sh
# expect: <repo>/worktrees/probe-name

printf '{"hook_event_name":"WorktreeRemove","worktree_path":"%s"}' "$PWD/worktrees/probe" \
  | .agents/skills/worktrees-pnpm/scripts/worktree-remove.sh
# ...and the same for worktrees/probe-name
```

**2. Add the ignores** described in the next section. Skipping this is the single most common way
to end up debugging a lint failure in code you never wrote.

## Every root-level tool must ignore the worktrees directory

This is the one real cost of keeping worktrees in the repo, and it is not optional. A worktree is
a **complete second checkout**. Anything that walks the tree from the root will walk into it —
linting, formatting, or type-checking another branch's code, and failing on whatever an agent has
half-written. The symptom is bewildering: your tooling fails on code you never wrote.

Placing worktrees outside the repo avoids this, but the path then depends on what the clone
directory is named, so committed config cannot reference it portably. In-repo plus ignores is the
trade: three one-line entries you control, instead of a path that silently differs per teammate.

**Add `worktrees/` to every tool that walks the tree from the root.** In this repo that is:

```gitignore
# .gitignore
worktrees/
```

```gitignore
# .prettierignore
worktrees/
```

```js
// eslint.config.js (flat config)
export default [{ ignores: ["worktrees/", ".claude/worktrees/"] }];
```

Other ecosystems, same idea:

```json
// .eslintrc.json (legacy)
{ "ignorePatterns": ["worktrees/"] }
```

```jsonc
// biome.json
{ "files": { "ignore": ["worktrees/"] } }
```

```toml
# pyproject.toml — ruff / black
[tool.ruff]
exclude = ["worktrees"]
[tool.black]
extend-exclude = "worktrees"
```

```json
// tsconfig.json — only if the root config globs sources itself
{ "exclude": ["worktrees"] }
```

Also check anything else that globs from the root: test runners (`vitest`/`jest` `exclude`),
bundlers, coverage tools, `.dockerignore`, and workspace globs in `pnpm-workspace.yaml`,
`package.json` `workspaces`, or a Cargo/Go workspace file.

**Do not assume which tools are affected — measure.** In this repo, `pnpm` workspaces and `tsc`
turned out _not_ to need an entry (the workspace glob is root-anchored, and typecheck runs
per-package through turbo), while `prettier` did — and it was invisible until worktrees moved out
of a dot-directory, because its globs skip dotfiles. Your repo's answer will differ.

The check that settles it, run with a worktree actually present:

```bash
git worktree add worktrees/probe -b throwaway-probe
touch worktrees/probe/UNFORMATTED.md

git status --porcelain | grep -c '^?? worktrees'          # expect 0
npx prettier --list-different "**/*.md" | grep -c worktrees  # expect 0
npx eslint --debug . 2>&1 | grep -c worktrees/probe       # expect 0
# ...and the same shape for every other root-level tool

git worktree remove worktrees/probe && git branch -D throwaway-probe
```

Any non-zero count is a tool that still needs an ignore entry.

## Gotchas and remediations

Each of these was hit for real in this repo.

**A branch can live in only one worktree.** If you need to edit a branch an agent worktree holds,
you have three options, in order of preference: hand the edit to the agent that owns it; work
directly inside that worktree, but _only_ if the agent is idle — never while it is running; or
remove the worktree if it has no work worth keeping.

**An idle agent's worktree still holds its branch lock.** A finished or stopped agent leaves the
worktree registered, so its branch stays unavailable. Check before reclaiming it:

```bash
git -C <worktree> status --short                        # uncommitted work?
git -C <worktree> log --oneline origin/<branch>..HEAD   # unpushed commits?
git worktree remove <worktree>                          # only when both are empty
```

**`git worktree list` shows a `worktree-<id>` branch you did not create.** That is the
placeholder branch made at creation time; an agent checks out the branch it actually needs
afterward, so the placeholder is not where the work is. Look at the branch the agent reports, not
the one in the listing.

**Never `mv` a worktree.** Use `git worktree move` — it rewrites the `.git` pointers and carries
`node_modules` along, so no reinstall is needed. Moving the directory by hand leaves the worktree
pointing at a path that no longer exists.

**A worktree survives between agent runs.** Resuming an agent reuses its worktree and its
`node_modules`, so a resumed agent does not pay the install again. Tell it to `cd $PWD` fresh
rather than trusting a path it cached in an earlier run — the worktree may have been moved.

## Problems that look like worktree problems and are not

Worth knowing, because misdiagnosing these wastes real time:

- **`--force-with-lease` fails with `stale info` on every branch.** That is a shallow or
  single-branch clone, not a worktree issue — there is no remote-tracking ref to lease against.
  See the shallow-clone entry in `CLAUDE.md`. The same cause breaks `git push -u` and makes
  `gh pr create` demand an explicit `--head`.
- **Several branches suddenly need rebasing and force-pushing at once.** That is `main` moving
  under an open stack, which happens whenever a PR merges. It is a stacking-cadence concern; see
  the stacked-PR guidance in `CLAUDE.md`.
- **A `git push` is rejected as non-fast-forward.** Check whether the remote branch was rebased
  independently (for example by GitHub's _Update branch_) before assuming your local history is
  wrong. If the remote already contains your commits under new SHAs, replay only what is missing
  with `git rebase --onto origin/<branch> <old-base> <branch>` rather than force-pushing over it.

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
git worktree remove worktrees/<name>   # add --force if it has uncommitted changes
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
