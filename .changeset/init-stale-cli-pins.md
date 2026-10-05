---
"@taskless/cli": patch
---

`taskless init` names any `package.json` pin of `@taskless/cli` or `@taskless/cli-nightly` that would run an older CLI than the one that just ran (a dependency whose installed build or range is behind, or a script spelling out an older version), with the version to move it to, and offers the bump. Scripts, CI and git hooks run that pin, and a CLI older than the project's `.taskless/` refuses the layout. The install does not edit `package.json`. `init --json` carries the pins as `pinnedCli`, and the `init` (topic v3) and `update` (topic v13) recipes tell an agent to offer the bump.
