#!/usr/bin/env bash
#
# WorktreeRemove hook — counterpart to worktree-create.sh.
#
# Fires when a session ends, a subagent finishes, or a background session is
# deleted. Because WorktreeCreate replaced the default creation logic, this must
# do the corresponding removal.
#
# Contract (docs: code.claude.com/docs/en/hooks):
#   stdin  - JSON with .worktree_path
#   stdout - ignored; this event is side-effect only
#   exit   - failures are logged in debug mode only and never surface to the user
#
# Because failures are invisible, this errs toward leaving things in place rather
# than deleting aggressively: uncommitted work in a worktree is real work, and a
# stale worktree is a cheap, visible problem (`git worktree list`) whereas
# silently discarded changes are not.
set -euo pipefail

payload=$(cat)
worktree_path=$(printf '%s' "$payload" | jq -r '.worktree_path // empty')
[ -n "$worktree_path" ] || exit 0
[ -d "$worktree_path" ] || exit 0

repo_root=$(git -C "$worktree_path" rev-parse --path-format=absolute --git-common-dir 2>/dev/null | xargs dirname) || exit 0

# Refuse to discard uncommitted changes. `git worktree remove` without --force
# already refuses, but check explicitly so the reason is greppable in debug logs.
if [ -n "$(git -C "$worktree_path" status --porcelain 2>/dev/null)" ]; then
  echo "WorktreeRemove: $worktree_path has uncommitted changes; leaving it in place" >&2
  exit 0
fi

git -C "$repo_root" worktree remove "$worktree_path" >&2 || {
  echo "WorktreeRemove: could not remove $worktree_path; leaving it for manual cleanup" >&2
  exit 0
}

# Drop the per-worktree branch this hook's counterpart created, but only if it is
# fully merged — `-d` (not `-D`) so an unmerged branch, which may be the only
# reference to real work, is left alone. Best-effort: both the "Deleted branch"
# notice and any refusal go to stderr for debug logs, and neither is fatal.
branch="worktree-$(basename "$worktree_path")"
git -C "$repo_root" branch -d "$branch" >&2 || true

# Remove the parent directory only when it is empty, so the sibling directory
# does not linger once the last worktree is gone.
rmdir "$(dirname "$worktree_path")" 2>/dev/null || true
