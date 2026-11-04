---
"@taskless/cli": patch
---

Fix the upgrade steps `agent ok` and `check` print. They told you to run the CLI with no arguments, which only installs from a terminal: anywhere else it printed the topic index and changed nothing. They now name `init`, which works in both.

Your agent now finishes the job after you upgrade. Moving the CLI stays yours to do, and once you have, the agent applies the rules instructions itself instead of handing them back. On a project launcher run, the upgrade step now names `npx` rather than a placeholder.

`agent ok` also offers the upgrade the way your harness runs it: with the `!` prefix in the Claude Code CLI, OpenCode, Codex, Gemini CLI, and Devin, and with `/shell` in Cursor. Another terminal is always offered, and it's the only offer when the harness isn't recognized.
