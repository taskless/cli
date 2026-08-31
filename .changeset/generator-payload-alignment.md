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

Refuse a runtime capture rule whose `match` mode this build does not
implement, instead of silently treating it as `anchor`.

The two modes scan different things: `anchor` is a syntactic narrow, `broad`
a whole-language enumerator. Defaulting an unrecognized third mode to
`anchor` did not degrade the capture, it reinterpreted it — the capture ran,
matched a fraction of what it was written for, and reported the shortfall as
a clean pass.

Discovery now refuses the capture, per file rather than per rule, so one
unimplemented mode cannot take a rule's other narrows down with it. `verify`
names the file, the offending value, and the valid modes, so a capture
dropping out of the run is explained rather than left looking like a rule
that found nothing.

Every reason a runtime capture rule is refused is now explained by `verify`.

Discovery dropped a capture silently for six distinct reasons — not a YAML
mapping, no `metadata.taskless` block, a `kind` other than `runtime`, a
non-string `language`, `name` or `id` — and a dropped capture makes a rule
report nothing, which is indistinguishable from a rule that passed. `verify`
now names the file and the reason for each.

Discovery and `verify` share one assessor, so "verify says the rule is fine"
and "the run silently skipped that capture" cannot come apart.

A capture declaring a `metadata.taskless.version` this build does not
implement is now refused rather than read as if it were version 1.

A runtime rule now has exactly one executable file, enforced rather than
assumed.

Only `check.ts` is signed; the capture `*.yml` are inert data the reconcile
gate neither signs nor reports. A second module beside `check.ts` would be
code reachable from a blessed entry point without being blessed itself — one
relative import away — so tampering with it bypasses the gate while `check.ts`
still matches its blessed digest. Such a rule is refused, and `verify` names
the file.

Every extension a check could import is covered, not only `.ts`. A rule's
`.tests/` fixtures are excluded, since a check reads real files under a root
and a fixture that is itself TypeScript is ordinary.
