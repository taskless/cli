---
"@taskless/cli": minor
---

Add Vale as a second static-tier rule engine.

`check` now dispatches by engine directory and runs ast-grep, Vale, and runtime
rules concurrently, merging their findings into one result set. Vale rules live
in `.taskless/vale/` and execute against the committed `.vale.ini`; an
unavailable Vale reports itself and the other engines still return, while a Vale
that times out or rejects its config fails the check rather than passing as a
clean run. Vale rules are verified from `rule-tests/<rule>/pass|fail` fixtures
against a generated per-rule config.

Adds the `engine-selection` knowledge topic — which engine enforces a given
rule, and why — available from `taskless help engine-selection` and exported
through `@taskless/cli/prompts`.
