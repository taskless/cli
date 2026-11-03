---
"@taskless/cli": patch
---

`taskless agent ok` is now a recipe that says whether your Taskless environment is up to date. It still confirms the CLI can run. It checks three things: whether a newer CLI is published, whether the installed skill matches this CLI, and whether the rules owe a reconcile. When all three are current it says "Your Taskless environment is up to date and you can proceed." Otherwise it lists numbered steps with the exact commands that fix each one. The Taskless skill tells the agent to hand those steps to you to run yourself (with `!` in Claude Code, or in another terminal) and to run `agent ok` again once you have. A local `taskless check` adds the same report as a single notice, without changing its results or exit code.

The newer-CLI check asks only the npm registry, once, with a one-second timeout. It accepts the answer only if it is a strict semantic version, and says nothing if the lookup fails. It is skipped in CI and when `NO_UPDATE_NOTIFIER` is set, and under `NO_UPDATE_NOTIFIER` a local `check` shows no notice at all. `agent ok` reads `.taskless/` but never writes to it.
