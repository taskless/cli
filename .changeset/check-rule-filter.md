---
"@taskless/cli": patch
---

`taskless check --rule <id>` (repeatable) restricts a run to the named rules, so a rule can be measured over the whole project without running every other rule and filtering the JSON afterwards. The filter applies to both static engines and to runtime rules, keeps every exclusion a whole-project run applies, and refuses an id no rule directory has.
