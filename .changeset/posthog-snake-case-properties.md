---
"@taskless/cli": patch
---

Telemetry property names are now snake_case, matching PostHog's own convention.

Seven properties are renamed on the wire: `cliVersion` becomes `cli_version`,
`scaffoldVersion` becomes `scaffold_version`, `durationMs` becomes
`duration_ms`, `loggedIn` becomes `logged_in`, `ruleCount` becomes
`rule_count`, and on `cli_check_completed`, `errorCount` and `warningCount`
become `error_count` and `warning_count`. `cli`, `anonymous`, `command`,
`success`, `findings`, and `gh_owner` are single words or already correct and
are unchanged.

PostHog's own properties are spelled `$current_url` and `$lib_version`, so a
project that mixes the two conventions gives you a property list nobody can
search: you have to know which spelling a given property happened to be born
with before you can filter on it. Seven is a cheap rename; fifteen would not have
been, and the discontinuity below is paid once per release rather than once
per property, so splitting the set across two releases would have cost twice
for the same work.

This is a hard cut, with no dual-emit window. **Historical events keep the old
spellings permanently**, so any PostHog query spanning this release needs both
names to see the whole series. Saved insights, dashboards, and cohorts that
filter or break down on these seven need updating by hand at the same time; they
will not error, they will silently return only the events emitted before the
release.

The `loggedIn` field in `taskless info --json` is a different wire format with a
different audience and stays `camelCase`. JSON payloads follow the JSON
convention and telemetry properties follow PostHog's, so the same value
legitimately appears under both spellings.
