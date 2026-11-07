---
"@taskless/cli": patch
---

`rule create` and `rule improve` no longer leave part of a request on disk when one of its rules is refused. Every rule a request produced is now checked (its engine, its paths, and whether its file set is complete) before the first is written, so a refusal leaves `.taskless/rules/` as it was. Under `--json`, these refusals now report `RULE_GENERATION_FAILED` or `RULE_UNSUPPORTED` instead of `INTERNAL_ERROR`.
