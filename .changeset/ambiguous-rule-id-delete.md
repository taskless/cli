---
"@taskless/cli": patch
---

`taskless rule delete` now refuses an id that two engines hold, instead of
deleting the first one it finds and reporting success. Nothing is removed in
that case, both paths are named, and `--json` reports a new
`RULE_ID_AMBIGUOUS` code. Rule ids are not unique across engines: nothing
enforces it, and the shipped demonstration rules carry no suffix, so the
uniqueness the search relied on was never a property of ids this CLI accepts.
