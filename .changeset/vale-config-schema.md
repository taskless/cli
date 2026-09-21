---
"@taskless/cli": patch
---

`verify` validates a Vale rule's `.vale.ini` against a schema and names the constraint each rejection violates. The config is parsed into an ordered structure and checked there: an assignment above the first matcher, a matcher without its `tskl) rule` breadcrumb, a key naming another rule, a value other than `YES`/`NO`, a non-empty `BasedOnStyles`, a config with no matcher or no `YES`, and a `NO` matcher that precedes every `YES` are each rejected under a `vale-config-*` constraint that `verify --json` reports in `violations[]` and `reference.json` publishes. A repeated key, a `[*]` matcher, and a `.taskless/**` matcher are reported as a notice without failing the rule. `check` is unchanged.
