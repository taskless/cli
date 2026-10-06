---
"@taskless/cli": patch
---

When `.taskless/.env.local.json` is tracked by git, the warning now gives the steps that help: `git rm --cached` to untrack it, check `.taskless/.gitignore`, and if the commit was pushed, replace the token with `auth logout` then `auth login`. Before, it only said to gitignore the file, which does nothing for a file git already tracks.
