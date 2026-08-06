#!/usr/bin/env bash
#
# WorktreeCreate hook — place worktrees at <repo>/worktrees/<id>.
#
# Default Claude Code behavior uses <repo>/.claude/worktrees/<id>; this moves them
# to a top-level `worktrees/` directory instead.
#
# A sibling directory (<repo>-worktrees/) was tried first and rejected: its path
# depends on what the clone directory is named, so committed settings.json cannot
# reference it portably — a teammate whose checkout is not named `skills` would be
# prompted for every file operation, silently and per-person.
#
# In-repo costs three ignore surfaces, because a worktree is a complete second
# checkout that root-level tooling walks into: .gitignore, .prettierignore, and
# eslint.config.js all exclude `worktrees/`. Verified as NOT needing one: pnpm
# workspaces (`packages/*` is root-anchored) and tsc (per-package via turbo).
#
# Layout: /path/to/<repo>  ->  /path/to/<repo>/worktrees/<worktree_id>
#
# Contract (docs: code.claude.com/docs/en/hooks):
#   stdin  - JSON identifying the worktree, plus .cwd, .session_id, ...
#            The id field is NOT stable across callers: a background agent's
#            payload carries `.name` (e.g. "agent-a5e1de46e730bdfd7") and no
#            `.worktree_id` at all, so both are read. Accepting only one of them
#            fails worktree creation outright with a message that reads like the
#            harness sent nothing.
#   stdout - the absolute path of the created worktree, plain text, REQUIRED
#   exit   - non-zero, or zero with empty stdout, fails worktree creation
# This hook replaces the default logic entirely, so it must run `git worktree add`.
set -euo pipefail

payload=$(cat)
worktree_id=$(printf '%s' "$payload" | jq -r '.worktree_id // .worktreeId // .name // empty')
if [ -z "$worktree_id" ]; then
  echo "WorktreeCreate: stdin carried none of .worktree_id/.worktreeId/.name" >&2
  exit 1
fi

# The id reaches both a filesystem path and a git ref, so constrain it rather
# than trusting its origin: `..` would escape the sibling directory, a leading
# `-` could be read as a flag, and ref-invalid characters would fail the
# `worktree add` further down with a much less obvious error. The harness only
# ever sends simple slugs; this makes that assumption explicit and cheap to keep.
if ! [[ "$worktree_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || [[ "$worktree_id" == *..* ]]; then
  echo "WorktreeCreate: refusing unsafe worktree_id '$worktree_id'" >&2
  exit 1
fi

# Resolve against the repo this hook was invoked for, not $PWD.
cwd=$(printf '%s' "$payload" | jq -r '.cwd // empty')
repo_root=$(git -C "${cwd:-$PWD}" rev-parse --show-toplevel)
worktree_dir="$repo_root/worktrees/$worktree_id"

# Idempotent, but only for a real worktree. A bare directory test would hand back
# a path that git knows nothing about — left by a partial cleanup, an interrupted
# run, or a stray mkdir — and the caller would treat creation as successful.
if git -C "$repo_root" worktree list --porcelain | grep -qxF "worktree $worktree_dir"; then
  echo "$worktree_dir"
  exit 0
fi

# A directory that is NOT a registered worktree is an unsafe place to add one:
# `git worktree add` would fail on a non-empty path anyway, so say why plainly.
if [ -e "$worktree_dir" ]; then
  echo "WorktreeCreate: $worktree_dir exists but is not a registered worktree" >&2
  exit 1
fi

mkdir -p "$(dirname "$worktree_dir")"

# Mirror the default: a fresh branch per worktree, based on current HEAD. The
# agent checks out whatever branch it actually needs once inside. -B rather than
# -b so a leftover branch from a removed worktree does not wedge creation.
# All git chatter goes to stderr; stdout carries the path and nothing else.
git -C "$repo_root" worktree add -B "worktree-$worktree_id" "$worktree_dir" >&2

echo "$worktree_dir"
