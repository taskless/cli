---
"@taskless/cli": patch
---

`init --json` now writes only the parseable envelope to stdout. Previously,
the non-interactive install path (also reached from `init --no-interactive
--json`) unconditionally logged human-readable prose — the "no tools
detected" fallback notice and the per-target skill/command summary — to
stdout ahead of the JSON envelope, so `taskless init --json | jq .` failed
with a JSON parse error. That prose now goes to stderr, where it stays
visible to a person watching the terminal without corrupting a machine
consumer's view of stdout, matching how `verify`/`test` and the migration
notice already behave under `--json`.
