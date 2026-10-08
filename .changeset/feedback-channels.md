---
"@taskless/cli": patch
---

An agent can now send the Taskless team general feedback (`taskless agent feedback`) or a bug report (`taskless agent bug-report`) on the user's behalf, without a GitHub account. Both show the user the exact payload and send only on their explicit yes, and both appear in the `taskless agent` index. A bug report's version information is filled in by the CLI from local state. The invited rule-authoring survey's recipe is renamed to `taskless agent rule-feedback`; its questions, invite, and cadence are unchanged. `feedback send` payloads now carry a required `kind` (`rule`, `general`, or `bug`). With telemetry disabled, nothing is sent and the CLI points to https://github.com/taskless/cli/issues instead.
