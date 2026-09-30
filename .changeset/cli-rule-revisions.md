---
"@taskless/cli": patch
---

Add `taskless rule revisions <ruleId>`, which lists a rule's recent revisions and marks the current one, so you can pick a revision for `taskless rule rollback` without opening the dashboard. The listing works on every plan. Under `--json` it prints `{ success, ruleId, revisions, truncated }`. The `recover-rule` agent recipe now walks through choosing a revision, and a rollback to a revision that isn't the rule's names `rule revisions` as the fix.
