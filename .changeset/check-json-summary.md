---
"@taskless/cli": patch
---

`check --json` now carries a `summary`: total findings, distinct files, counts by severity, and one entry per rule that fired, keyed by `engine` and `ruleId`. The new `--summary` flag returns only that summary (under `--json` it omits `results`), so an agent can measure a whole repository in one call whose output stays small; without `--json` it prints per-rule counts. Findings from `check --json` and `verify --json` now share one schema, published as `findingSchema` from `@taskless/cli/schemas` alongside `checkOutputSchema`.

Patch: the package is 0.y.z and the change is additive. `results` and every existing key are unchanged unless you pass the new `--summary` flag, so no existing consumer has to react.
