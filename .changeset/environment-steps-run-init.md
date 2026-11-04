---
"@taskless/cli": patch
---

Fix the upgrade steps `agent ok` and `check` print. They told you to run the CLI with no arguments, which only installs from a terminal: anywhere else it printed the topic index and changed nothing. They now name `init`, which works in both.
