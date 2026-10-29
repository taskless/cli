---
"@taskless/cli": patch
---

`taskless init` now says when the project's rules need `update --rules`, on every run rather than only when the CLI version moves, with the same answer as `reconcile` (`{ required, engines, ruleMigrations }`) on `init --json` and `update --json`, and as `rules.reconcile` on `info --json`. Previously, moving between two nightlies of one release that bumped ast-grep or Vale reported nothing to walk, while `check` and `verify` refused with `RULES_ENGINE_MISMATCH` until `update --rules` ran.
