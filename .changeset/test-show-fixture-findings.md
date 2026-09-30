---
"@taskless/cli": patch
---

`test --json` now reports the findings a rule's fixtures produced.

Each rule result carries a `findings` array: the same finding shape `check --json` prints — `source`, `ruleId`, `severity`, `message`, `file`, `range`, `matchedText`, and the optional `note` and `fix` — plus a `bucket` of `"pass"` or `"fail"` naming the fixture that produced it. The rendered `message` is the point. A rule whose message interpolates its captures can have the slots in the wrong order, fire on every `fail/` fixture, stay quiet on every `pass/` one, and be reported as a rule that passed; the rendered message is the only evidence otherwise, and until now the only way to see it was a second `check` run against a fixture path you had to construct yourself.

The array is **always present and empty rather than absent** — for a rule that produced nothing, one whose verification failed before its fixtures ran, a refused runtime rule, `verify` (which runs no fixtures at all), and ast-grep rules, whose findings are not surfaced yet. Fail-bucket findings are reported on a passing run too, since that is the only run that produces them.

On the human path a passing rule still prints one line. A **failing** rule now prints the findings that bear on the failure beneath it, labelled by bucket and rendered the way `check` renders a finding. That includes pass-bucket findings: `pass fixture wrongly fired: <file>` said _that_ it happened and never what matched.

Vale and runtime rules only. ast-grep follows separately: the vendored binary's `sg test` has no `--json` and no output-format flag, and its fixtures are inline YAML scalars rather than files.

No flag was added, and nothing new is executed: the findings were already in hand and were being discarded.

**If you consume `@taskless/cli/schemas`:** `zod`'s `.parse()` strips keys the schema does not declare, so a consumer still on the previously published `verifyTestOutputSchema` will silently drop `findings` from the payload it returns until the dependency is upgraded. Nothing breaks — but the field simply not being there, on a CLI that is emitting it, is the kind of thing that generates a bug report.
