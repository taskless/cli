## Why

An author iterating on a new rule wants one number: how many times does this rule fire across the repository, before it ships at `warning`. `check` has no way to ask that. It runs every rule in `.taskless/rules/`, so the documented workaround is to run everything and filter afterwards:

```
taskless check --json | jq '[.results[] | select(.ruleId == "<id>")] | length'
```

That runs every engine and every rule to answer a question about one. On the dogfood repository (~1,100 markdown files, eleven voice rules) it is the slow path on every iteration of a branch. `test <path>` does isolate one rule, but it runs only that rule's fixtures and never the project, so it cannot answer the question at all.

## What Changes

- `taskless check --rule <id>`, repeatable, restricting the run to the named rules. `--rule a --rule b` measures both.
- The narrowing is per engine, because the engines narrow by different mechanisms:
  - **ast-grep**: `sg scan --filter '^(?:a|b)$'`, ast-grep's own flag for scanning with a subset of the rules a config loads. Everything else about the invocation — the config, the walk, `--no-ignore hidden`, the `--globs` exclusions — is byte-identical to an unfiltered run.
  - **Vale**: the assembled `.vale.ini` is built from only the selected rules, each rule's own matchers kept verbatim. Vale has no rule-selection flag, so the config is the only place to express it.
  - **runtime**: the discovered rule list is filtered before planning, so `--rule` narrows what may run and never widens it — a runtime rule named here still faces the signature gate.
- An id that names no rule directory under any engine is a **refusal** (`RULE_NOT_FOUND`, exit 1, the id named). A typo that silently measured nothing would report "0 findings", which is also what a clean rule reports, and those are the two answers the author is choosing between.
- An id held by two engines selects both. `check` with no filter would have run both, and `--rule` narrows a run rather than redefining it.

Nothing here is **BREAKING**. Pre-1.0, an added flag is a `patch`; nothing that exists today changes behavior when `--rule` is absent.

## Non-goals

- `--rule` does not take a path. `test` takes a path, `check --rule` takes an id, which is what a finding carries in `ruleId` and what the author reads out of the JSON.
- `--rule` does not override the runtime signature gate, and does not re-enable a rule the project has removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-check`: one new requirement, "Check restricts the run to named rules with --rule". Nothing existing is modified — `--rule` narrows a run the way positional paths already do, and the auth, dispatch and exit-code requirements are unchanged.

## Impact

- `packages/cli/src/commands/check.ts`: the `--rule` flag, its repeatable argv parsing, and the resolution/refusal.
- `packages/cli/src/rules/rule-filter.ts` (new): resolve requested ids into a per-engine selection, or refuse.
- `packages/cli/src/rules/scan.ts`: `--filter` argv for ast-grep.
- `packages/cli/src/rules/assemble.ts`: Vale assembly accepts a rule-id narrowing.
- `packages/cli/src/rules/dispatch.ts`: carries the ast-grep selection through to the scan.
- `packages/cli/test/check-rule-filter.test.ts` (new).
- `packages/cli/src/agent/create-vale-rule.md`: the corpus-count passage should name the flag. **Deliberately not touched here** — that file is being edited on another branch, and the recipe change is a follow-up (taskless/cli#379, last bullet).

## Delivery shape

**Single PR.** One flag, its per-engine plumbing, its tests, the spec delta and the archive fit one reviewable diff, and the change is safe in production on its own: with `--rule` absent every code path is the one that shipped.
