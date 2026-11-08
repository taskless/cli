---
"@taskless/cli": patch
---

`rule create` and `rule improve` no longer leave part of a request on disk when one of its rules is refused. Every rule a request produced is now checked (its engine, its paths, and whether its file set is complete) before the first is written, so a refusal leaves `.taskless/rules/` as it was. Under `--json`, these refusals now report `RULE_GENERATION_FAILED` or `RULE_UNSUPPORTED` instead of `INTERNAL_ERROR`.

An IO failure while the rules are being written (a full disk, a directory the CLI cannot write to) no longer leaves the earlier rules on disk either: every rule is staged under `.taskless/` first and moved into place afterwards, and a failure part-way moves back any rule already replaced, so `.taskless/rules/` is left as it was and the command reports `RULE_GENERATION_FAILED`.
