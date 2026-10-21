---
"@taskless/cli": patch
---

The setup wizard now offers to commit what it installed. An agent that works in a git worktree builds it from commits, so until the install is committed it sees no Taskless at all. Choose the suggested message, write your own, or commit it yourself; the commit carries only Taskless's files and leaves anything else you had staged alone. `init` without the wizard says the commit is owed instead.

The onboard recipe (topic v10) now starts by checking for that case: in a worktree where `.taskless/` was never committed, it tells you to commit `init`'s files in your main checkout and start a new worktree, instead of onboarding into a checkout that has no install.
