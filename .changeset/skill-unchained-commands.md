---
"@taskless/cli": patch
---

The installed Taskless skill now tells agents to run each Taskless command as its own shell call, with nothing chained around it. An agent that wrote `echo ======` between two commands lost the second one in zsh, which treats the separator as an error and drops the rest of the line, so `detect` was skipped without anything reporting it.
