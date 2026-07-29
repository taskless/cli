#!/usr/bin/env bash
#
# WorktreeCreate hook — place worktrees BESIDE the repo, not inside it.
#
# Default Claude Code behavior creates worktrees at <repo>/.claude/worktrees/<id>.
# A worktree is a complete second checkout, so nesting it inside the repo means
# every tool that walks the tree from the root walks into it. We hit that: a root
# `eslint .` traversed 2983 files across two agent worktrees and failed on code an
# agent had half-written. An ignore rule patches one tool; placing worktrees
# outside the repo makes the whole class of problem impossible.
#
# Layout: /path/to/<repo>  ->  /path/to/<repo>-worktrees/<worktree_id>
#
# Contract (docs: code.claude.com/docs/en/hooks):
#   stdin  - JSON with .worktree_id (and .base_path, .cwd, .session_id, ...)
#   stdout - the absolute path of the created worktree, plain text, REQUIRED
#   exit   - non-zero, or zero with empty stdout, fails worktree creation
# This hook replaces the default logic entirely, so it must run `git worktree add`.
set -euo pipefail

payload=$(cat)
worktree_id=$(printf '%s' "$payload" | jq -r '.worktree_id // empty')
if [ -z "$worktree_id" ]; then
  echo "WorktreeCreate: no .worktree_id on stdin" >&2
  exit 1
fi

# Resolve against the repo this hook was invoked for, not $PWD.
cwd=$(printf '%s' "$payload" | jq -r '.cwd // empty')
repo_root=$(git -C "${cwd:-$PWD}" rev-parse --show-toplevel)
worktree_dir="$(dirname "$repo_root")/$(basename "$repo_root")-worktrees/$worktree_id"

# Idempotent: an existing worktree at this path is returned as-is.
if [ -d "$worktree_dir" ]; then
  echo "$worktree_dir"
  exit 0
fi

mkdir -p "$(dirname "$worktree_dir")"

# Mirror the default: a fresh branch per worktree, based on current HEAD. The
# agent checks out whatever branch it actually needs once inside. -B rather than
# -b so a leftover branch from a removed worktree does not wedge creation.
# All git chatter goes to stderr; stdout carries the path and nothing else.
git -C "$repo_root" worktree add -B "worktree-$worktree_id" "$worktree_dir" >&2

echo "$worktree_dir"
