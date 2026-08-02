---
"@taskless/cli": minor
---

Partition `.taskless/` by rule engine. Migration `0004` moves ast-grep rules to `sg/rules/` and `sg/rule-tests/`, the runtime tree to `runtime/rules/` and `runtime/rule-tests/`, and scaffolds an inert `vale/`. Files move byte-for-byte, so runtime rule signatures survive.

The directory a rule sits in now **is** its engine: dispatch reads the path and never parses a rule file to decide who owns it. `check` runs ast-grep against the committed `.taskless/sg/sgconfig.yml` instead of generating an ephemeral config each run.

Existing projects keep working without action. The pre-`0004` `.taskless/rules/` still runs as ast-grep, and a delivered rule that names no engine is still treated as ast-grep — a rule engine this CLI does not recognize is rejected rather than guessed at. A migration that would have to merge a file into an engine directory now refuses up front with `SCAFFOLD_CONFLICT` rather than failing part-way.
