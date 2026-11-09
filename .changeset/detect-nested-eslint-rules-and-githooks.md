---
"@taskless/cli": patch
---

`taskless detect` reads two more places where a repository already keeps its lint setup.

- ESLint rule directories (`eslint-rules`, `eslint-local-rules`, `tools/eslint-rules`) are now found beside every ESLint config, not only at the repository root. A root run on a repository whose ESLint setup lives in `dashboard/` now counts the rules in `dashboard/eslint-rules` and reports that directory as a rule style, matching what a run from `dashboard/` already reported.
- Plain hook scripts in a tracked `.githooks/` directory are reported under `hooks` as `githooks`, with each script as evidence, and a linter those scripts run counts as detected. `core.hooksPath` is not read, since a fresh clone does not carry it. `taskless init` also checks these scripts for stale Taskless CLI pins.
