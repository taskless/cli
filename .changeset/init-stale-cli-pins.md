---
"@taskless/cli": patch
---

`taskless init` names any `package.json` pin of `@taskless/cli` (a dependency entry, or a script spelling out `@taskless/cli@<version>`) that cannot resolve to the CLI that just ran, and offers bumping it as part of the upgrade. Scripts, CI and git hooks run that pin, and a CLI older than the project's `.taskless/` refuses the layout. The install does not edit `package.json`. `init --json` carries the pins as `pinnedCli`, and the `update` recipe (topic v13) tells an agent to offer the bump.
