---
"@taskless/cli": patch
---

The setup wizard lists every supported harness by name (Claude Code, OpenCode, Cursor, Codex, Gemini CLI, Crush, Devin, and other Agent Skills harnesses), so you no longer need to know which directory your harness reads. Harnesses found in the project are listed first and pre-checked; harnesses found on this machine come next, unchecked. Installing stays project-local. Checking Codex now also writes its permission rule, even in a project without `.codex/`. Devin is new: it installs into `.devin/` when the project has one, and `.agents/` otherwise.
