---
"@taskless/cli": patch
---

`.taskless/.gitignore` now ignores `/.tmp-*`, the scratch request files the agent recipes write (`.tmp-rule-request.json`, `.tmp-improve-request.json`), so a file an agent forgot to clean up is a stray rather than a commit. This is scaffold migration 7; the scaffold's own `version` field carries the compatibility signal, and a project at 6 gains one ignore line the next time it is bootstrapped.

A `feedback` subcommand joins the CLI, reached only through the survey invite a served recipe carries and so absent from the `taskless agent` index: `feedback send --from <file>` validates a human-keyed payload (`verbatim`, `goal`, `completed` as `Yes`/`No`/`Unknown`, optional `workedWell` and `needsImprovement`), maps it to the PostHog survey's question ids, and captures `survey sent`; `feedback dismiss` captures `survey dismissed`. Both hold the next invite off for 20 days and, under the telemetry opt-out, say nothing was sent and exit 0.
