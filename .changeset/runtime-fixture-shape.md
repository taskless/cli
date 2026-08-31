---
"@taskless/cli": patch
---

Document where a runtime rule's test fixtures go.

`create-runtime-rule` described a rule directory as `captures/*.yml` plus
`check.ts` and said nothing about `.tests/`, so an agent authoring a runtime
rule had no statement of the fixture layout at all. `verify-rule` reported
runtime tests as "not run" without saying what was not being run.

Both now state it: cases live in `.tests/pass/` and `.tests/fail/`, and a
case is a **directory** whose path is the `root` the harness hands the
check, so it may hold as many files as the case needs. That last part is
load-bearing rather than incidental — a runtime rule exists because its
evidence spans more than one file, so a layout allowing one file per case
could not express the rules the tier is for.
