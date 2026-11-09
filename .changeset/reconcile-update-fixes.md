---
"@taskless/cli": patch
---

Fix three places where `update` and `agent ok` gave the wrong reconcile advice.

- `update --rules` from an older nightly of the same release no longer rewinds the recorded reconciliation and engine versions; it refuses and says to upgrade. It also refuses when the project's rules are recorded against newer engines than this CLI bundles. `info --json`, `init --json` and `update --json` now list those engines under `reconcile.enginesAhead`, so they explain why `check` refuses instead of reporting nothing due.
