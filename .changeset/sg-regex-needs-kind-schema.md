---
"@taskless/cli": patch
---

`sg-regex-needs-kind` now lives in the ast-grep rule schema. The schema the CLI publishes states the pairing as `if`/`then` on every rule definition, and `validate` reports it from the schema layer with the same paths, so a schema-aware tool flags exactly what `validate` refuses. Every `regex`, at any depth, is covered: `rule`, `constraints`, `utils`, every `any`/`all`/`not`/`has`/`inside`/`precedes`/`follows` sub-rule, and the rarer positions (`stopBy`, `nthChild.ofRule`, utility arguments, `fix.expandStart`/`expandEnd`, rewriters). A sibling `any:` whose every branch sets a `kind` now anchors the regex, so a constraint no longer has to be split into one branch per kind, and an `all:` with one branch that sets a `kind` counts too. The message says how to find the kind, and it is reported even when another field also fails the schema. The `create-sg-rule` recipe (topic v15) lists the rule under Quirks.
