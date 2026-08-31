---
"@taskless/cli": patch
---

`taskless rule delete` now resolves which engine holds a rule instead of
assuming ast-grep.

`deleteRuleFiles` hardcoded `.taskless/rules/sg/<id>/`, which was invisible
while ast-grep was the only engine a rule could be delivered for. A Vale or
runtime rule could be written and then not removed, and `delete` reported
"not found" for a rule plainly on disk. The failure message named an
`sg/` path that a non-ast-grep rule was never going to be at.

Also corrects seven comments describing the pre-`0005` layout
(`.taskless/<engine>/rules/`) rather than the current
`.taskless/rules/<engine>/`. One of them is in `types/runtime-rule.ts`, which
defines the harness contract and is where a reader goes to be sure.

Publishes the rule layout table as `@taskless/cli/layout`.

`ENGINES`, `ENGINE_LAYOUTS`, `RULES_DIRECTORY`, `RULE_TESTS_DIRECTORY` and
`isKnownEngine` are now importable as data, from an entry that reaches no
filesystem, network, telemetry or command tree — so a Worker can load it. A
service building a rule payload can validate against the table the CLI itself
dispatches on rather than transcribing it.

The build enforces the constraint: `assert-library-graphs` walks each library
entry's resolved chunk graph and refuses to emit one that imports a host
capability or reaches the CLI entry. `tsconfig.prompts.json` becomes
`tsconfig.public.json`, since it now supplies declarations for both public
subpath exports.
