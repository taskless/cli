---
"@taskless/cli": patch
---

`taskless rule restore` and `taskless rule rollback` no longer leave a half-written rule when a write fails part-way, for example on a full disk or an unwritable file. The rule is written in full under `.taskless/` first and then moved over its directory, and a failed move puts the previous version back, so `.taskless/rules/` is left as it was. Under `--json` that failure is now `RULE_RESTORE_FAILED`, and a served rule that cannot be written is `RULE_RESTORE_MISMATCH`, rather than `INTERNAL_ERROR`. The rule directory is replaced as a whole, so files the served rule does not include no longer survive a restore, and the "stale entries could not be removed" notice is gone.
