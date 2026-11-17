---
"@taskless/cli": patch
---

The installer's offer to commit the Taskless files no longer looks hung while your git hooks run. git now runs in your terminal exactly as if you had typed `git commit`, so hook output, prompts and interactive displays (lefthook, husky, pre-commit) show as they would normally, and the installer says the hooks are running before it starts. When the commit does not go through, because a hook refused it or you pressed Ctrl-C, the installer asks whether to try again, commit without running git hooks, or leave the commit to you. It never skips your hooks unless you choose to, and the install and the onboarding prompt survive either way. A cancelled install now tells you to run `npx @taskless/cli` with no arguments to try again, instead of `init`, which installs without prompts and never reopens the installer.
