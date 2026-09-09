---
"@taskless/cli": patch
---

Telemetry now records six adoption dimensions on every event: `workspaceId` and
`repositoryId` (both hashed), `envOS`, `ci`, `ciProvider`, and `languageStack`.
`cli_check_completed` also reports `ruleCount`, so a scan that loaded no rules
is distinguishable from one that loaded rules and found nothing.

Nothing to react to. No command changes behaviour, no output changes shape, and
every dimension falls back to a sentinel rather than failing — telemetry is not
a precondition for any command. `TASKLESS_TELEMETRY_DISABLED=1` and
`DO_NOT_TRACK=1` continue to short-circuit before any of it is resolved, so the
opt-out remains an opt-out of the work rather than only of the send.

`patch` rather than `minor` because the package is pre-1.0, where added surface
does not earn a `minor`, and because none of this is API a consumer can call.
