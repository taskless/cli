---
"@taskless/cli": patch
---

`taskless init` now says when the project's rules need `update --rules`, on every run rather than only when the CLI version moves, and `init --json` carries the same answer as `rules`. `info --json` and `update --json` report it as `rules.reconcile` and `reconcile`. Previously, moving between two nightlies of one release that bumped ast-grep or Vale reported nothing to walk, while `check` and `verify` refused with `RULES_ENGINE_MISMATCH` until `update --rules` ran.
