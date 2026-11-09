---
"@taskless/cli": patch
---

Fix three places where `update` and `agent ok` gave the wrong reconcile advice.

- `update --rules` from an older nightly of the same release no longer rewinds the recorded reconciliation and engine versions; it refuses and says to upgrade. It also refuses when the project's rules are recorded against newer engines than this CLI bundles. `info --json`, `init --json` and `update --json` now list those engines under `reconcile.enginesAhead`, so they explain why `check` refuses instead of reporting nothing due.
- `update --json` on a project whose `.taskless/taskless.json` cannot be read now exits 1 with a `SCAFFOLD_MANIFEST_UNREADABLE` error envelope, instead of reporting `ok: true` with nothing due. In a directory with no `.taskless/` it reports `reconcile.required: false`.
- `agent ok` no longer tells the agent to hold the rules step back for "a newer CLI" when only the skill needs reinstalling. With no CLI upgrade owed, it tells the agent to apply the rules step now.
