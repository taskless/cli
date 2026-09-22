## Context

`check --rule <id>` has to report, for the named rule, exactly what an unfiltered `check` reports for that rule. Not approximately: the author writes the number into a branch's record and compares it against the number `check` produces in CI. Any divergence between "the filtered path" and "the unfiltered path" is a wrong number that nothing detects.

That constraint decides the mechanism, engine by engine.

## Decisions

### The issue's suggestion (reuse `buildIsolatingConfig`) is the wrong mechanism for Vale

taskless/cli#379 proposes reusing "the isolating config `test` already assembles for one rule, pointed at the project walk instead of the fixture tree". Read, that config (`rules/vale/verify.ts`) is:

```
StylesPath = <abs>
MinAlertLevel = suggestion

[*]
<id>.<id> = YES
```

`[*]` is the problem. It is correct for a fixture tree, where every document exists to exercise the rule, and wrong for a project walk: a rule scoped `[docs/**.md]` by its own config would, under this config, be measured over every file Vale can read, code included. The count would be larger than `check` reports, and larger in a way that looks like the rule being noisy rather than like the harness being wrong. The config schema calls the same shape out in a rule's own config (`matcher [*] enables <id> for every file Vale can read, code included`).

**Instead, assembly is narrowed.** `assembleValeConfig` takes the selected ids and emits only those rules' blocks, each rule's own matchers verbatim. The rule's scope is then byte-identical to what it is in a full run.

**Narrowing applies to what is written, not to what is validated.** Every Vale rule's config is still read and put through the config schema, and any rejection still refuses the whole assembly; only the surviving blocks are filtered. Validating just the selected rules would let `check --rule good` exit clean in a project where `bad`'s config is rejected, while an unfiltered `check` there refuses the Vale engine and reports nothing for `good` — the filtered run would then report findings the unfiltered run never produced, which is the exact equality this flag rests on.

Removing the other rules' blocks cannot change the surviving rule's effective setting, and that is a fact about the config schema rather than an assumption: a rule's config may only assign its own `<id>.<id>` key — the schema rejects an assignment that "names another rule" — so no removed block could have been turning the selected rule on or off. Vale's positional precedence (last matcher wins; since 3.21.0 last assignment within a matcher wins) has nothing to act on across rules.

### ast-grep narrows with `--filter`, not by narrowing `ruleDirs`

ast-grep 0.45.3 has `scan --filter <REGEX>`: "Scan the codebase with rules with ids matching REGEX." It changes exactly one thing — which loaded rules may report — leaving the config, the walk, `--no-ignore hidden` and the two `--globs` exclusions untouched. The alternative, writing an assembled config whose `ruleDirs` names only the selected rule directories, would have been a second config-generation path to keep in step with the first.

The regex is anchored (`^(?:a|b)$`). Unanchored, `--rule no-eval` would also report `no-eval-in-tests`.

### An unknown id is a refusal, not an empty run

A `--rule` naming nothing runs nothing and reports "0 findings" — which is also what a rule that fires nowhere reports, and that is precisely the answer the author is trying to obtain. The two must not look alike, so an unresolvable id exits 1 with `RULE_NOT_FOUND` and the id in the message.

Resolution happens **before** the "No rules configured" gate, so the message is about the id in every project rather than about the project in some of them.

### An ambiguous id selects both rules

`rules delete` refuses an id held by two engines (`RULE_ID_AMBIGUOUS`) because deleting the wrong one is irreversible. Measuring is neither irreversible nor destructive, and an unfiltered `check` would have run both, so `--rule` runs both and each finding carries its engine in `source`.

### `--rule` is read from raw argv

The flag is repeatable, and a parser that collapses a repeat to one value turns `--rule a --rule b` into a measurement of one rule while the author reads the number as covering two. Values are scanned out of `rawArgs` (both `--rule a` and `--rule=a`, stopping at `--`), and `--rule` is added to the value-taking flags the shared positional scanner knows — without that, `check --rule no-eval` scans `no-eval` as a path, finds no such file, and takes the "every supplied path was filtered out" branch: a clean exit 0 with no findings, indistinguishable from the measurement the author wanted.

### An engine with nothing selected is skipped, not filtered to nothing

Handing ast-grep a filter that matches no rule still spawns it, loads every rule and walks the project to report none. When the selection contains no `sg` rule the engine is skipped outright; Vale assembly returns `undefined` for the same case, which dispatch already reads as "nothing to run".
