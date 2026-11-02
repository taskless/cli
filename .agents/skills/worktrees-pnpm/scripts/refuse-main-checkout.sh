#!/usr/bin/env sh
#
# pre-commit guard: refuse commits made in the repository's primary checkout.
#
# All work happens in a worktree under .agents/.worktrees/. The primary checkout
# is the one every agent is told never to touch, because an agent that lands
# there edits, branches and commits in the user's own working tree. Telling it
# not to has not been enough, so the commit is refused instead.
#
# The test: in a linked worktree, --git-dir is .git/worktrees/<name> while
# --git-common-dir is the shared .git. In the primary checkout both are the same
# directory. This does not care what branch is checked out, so it also stops a
# commit to a feature branch that someone checked out in the primary tree.
#
# Not enforced on GitHub Actions: the runners commit from a plain clone
# (changeset version PRs, review actions), and a plain clone is a primary
# checkout. The skip keys on GITHUB_ACTIONS, which the runner sets itself,
# rather than CI, which any shell exports and which no instruction names, so it
# would be a quieter bypass than --no-verify.
#
# Escape hatch for a person's deliberate commit here: git commit --no-verify
set -eu

if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  exit 0
fi

# Both paths are resolved physically rather than with
# `rev-parse --path-format=absolute`, which git before 2.31 rejects. Under
# `set -e` that rejection would fail the hook everywhere, worktrees included,
# leaving --no-verify as the only way to commit. `pwd -P` also settles symlinks
# and relative output, so the comparison is path to path.
git_dir=$(cd "$(git rev-parse --git-dir)" && pwd -P)
common_dir=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)

if [ "$git_dir" = "$common_dir" ]; then
  top=$(git rev-parse --show-toplevel)
  cat >&2 <<EOF
Refusing to commit in the primary checkout ($top).

Work in a worktree instead:
  git fetch origin +refs/heads/main:refs/remotes/origin/main
  git worktree add --no-track -b <branch> .agents/.worktrees/<name> origin/main
  cd .agents/.worktrees/<name> && pnpm install

--no-track keeps the branch from tracking origin/main, so a bare git push
cannot target main.

To commit here deliberately: git commit --no-verify
EOF
  exit 1
fi
