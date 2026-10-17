---
"@taskless/cli": patch
---

The Claude Code trust entry now stays current, and Taskless commands stop tripping auto mode by being chained.

- Running `npx @taskless/cli` with no arguments now offers to replace a `Taskless CLI:` entry in `~/.claude/settings.json` whose text is out of date, under the same one question it asks for every settings edit. `init` still never writes outside the project: it warns, and `init --json` reports the entry as `stale`.
- The entry also covers a pinned Taskless call when the same command line sets a variable, changes or creates a directory, or redirects the call's output to a file. Every other command on the line is still judged on its own.
- The installed skill tells agents to run each Taskless command on its own line, and when auto mode refuses one while the entry is already present, to say so rather than asking the user to add it again.
