---
"@taskless/cli": minor
---

The `/tskl` slash command is removed. `taskless init` no longer installs it, and upgrading removes the copies an earlier install wrote, from `.taskless/commands/` and from each tool's `commands/tskl/`. Other files in a tool's `commands/` directory are left alone.

What to do: ask your agent in plain language instead, such as "set up taskless" or "add taskless to CI". The Taskless skill picks that up the same way `/tskl` did. The `init --json` envelope drops `commandsInstalled` and each target's `writtenCommands`, and keeps `removedCommands`, which is where the removal shows up.
