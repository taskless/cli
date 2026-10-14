---
"@taskless/cli": patch
---

`taskless detect --json` now reports ast-grep and Vale configurations as linters (Taskless's own configuration under `.taskless/` excluded), the command-line tools on the host's `PATH` (`gh`, `git`, `jq`, and now `glab` for GitLab repositories) under `hostTools`, and an `agent` section of commands an agent may choose to run to check whether a source is usable, such as `gh auth status`. Detection still runs nothing and stays offline.
