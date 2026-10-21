---
"@taskless/cli": patch
---

Telemetry can now be turned off for a whole project with `"telemetry": false` in `.taskless/taskless.json`. The file is checked in, so this applies to everyone working in the repository, CI included. Like `TASKLESS_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1`, it skips the work as well as the send: no client is created and no network request is made. The setup wizard and `taskless init` now say that Taskless collects anonymous telemetry and name all three opt-outs, and `init --json` reports `telemetry: { enabled }` so an agent running the install can pass that on.
