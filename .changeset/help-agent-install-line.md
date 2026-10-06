---
"@taskless/cli": patch
---

Every `--help` now opens with a line telling an agent that wants to install or update Taskless to run `init` first. An agent without the Taskless skill tends to start from `--help` and improvise commands; `init` installs the skill and recipes that keep sessions consistent. The command names the launcher and the exact build you ran, so a pinned nightly points at itself.
