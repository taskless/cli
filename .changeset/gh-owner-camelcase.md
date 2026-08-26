---
"@taskless/cli": patch
---

Spell the telemetry property `ghOwner` rather than `gh_owner`.

Telemetry names events in `snake_case` (`cli_run`, `cli_check_completed`) and properties in `camelCase` (`cliVersion`, `durationMs`, `errorCount`). `gh_owner` was added in the previous change with the event convention applied to a property by mistake, and it was the only property in the codebase spelled that way.

No migration is needed for anyone reading this: the property was introduced in this same unreleased cycle, so no stable build ever emitted `gh_owner` and no saved insight can be filtering on it.

The convention is now stated normatively in the `analytics` spec, so it can be checked rather than inferred from whichever names happen to exist.
