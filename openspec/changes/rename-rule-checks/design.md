## Context

Both commands live in `commands/verify.ts` and share one body, `runOverPath`, selected by a `label: "verify" | "test"` that also picks the summary wording ("verified" or "tested"). Per-rule work is `verifyOneRule` and `testOneRule` in `rules/inspect.ts`. Below that, `rules/verify.ts` holds the `sg` layers: schema, house requirements, and `runTests`, which spawns `sg test` with a config from `assembleSgConfig(cwd)`. That config names every rule in the project, and `--filter` narrows only which tests run, so ast-grep parses every rule before running any test. That's how one rule's config error fails another rule's fixture run under the wrong name (proposal, gap 2).

`SUBCOMMAND_NAMES` in `commands/names.ts` is the single source of truth for command names, and `test/recipe-cross-references.test.ts` reads it to check that every `taskless <cmd>` a recipe names exists. That test is the main guard that the rename leaves no recipe pointing at a missing command.

The house rule `no-unrouted-cli-invocation` names `packages/cli/src/schemas/verify-test.ts` as a path, so renaming that file means editing the rule in the same commit.

## Goals / Non-Goals

**Goals:**

- No identifier, file name, message, recipe or spec uses `verify` with the old meaning after PR 1. A reader who meets `verify` anywhere in this repository reads the new meaning.
- `validate` makes exactly one engine call per `sg` rule, it scans nothing, and it runs no fixtures.

**Non-Goals:**

- Isolating `check` from one rule's config error. `check` still assembles every `sg` rule into one config. `validate` now names the offending rule, which is the actionable part.
- An engine parse for Vale rules. Vale validates a rule only when it runs one field at a time (see `cli-rule-validation`), so a parse adds nothing the config and rule schemas don't already decide.
- Ast-grep rules written over our own YAML for the trap notices. The issue mentions them as possible, but the three traps are decidable from the parsed rule object, and a second engine pass to detect them would cost a spawn per rule.

## Decisions

### Rename in two passes, never one

A simultaneous swap (`verify` → `validate`, then `test` → `verify`) done as two sequential find-and-replace passes rewrites the second pass's output: every new `verify` gets turned into `validate`. The rename goes in this order:

1. `verify` → `validate` everywhere it means the old command. Commit.
2. `test` → `verify` everywhere it means the old command. Commit.

Between the two commits the tree has no `verify` command at all, which the cross-reference test reports if a recipe still names one. That makes the first commit a checkpoint that the first pass is complete. Spec deltas were generated with a one-pass simultaneous substitution instead, since there the input is a frozen copy.

_Alternative:_ a single scripted simultaneous substitution over source too. Rejected because source uses the word in more shapes than specs do (`verifyOneRule`, `label === "verify"`, `"verified"`, `TestLayerResult`), and a reviewer can't check a one-pass swap one commit at a time.

### Internal names follow the commands

`verifyOneRule` → `validateOneRule`, `testOneRule` → `verifyOneRule`, `verifyCommand` → `validateCommand`, `testCommand` → `verifyCommand`, and `schemas/verify-test.ts` → `schemas/rule-check.ts`. The two-pass order above applies to identifiers as well. `rules/verify.ts` and its `verifyRule()` already mean "every layer, fixtures included", which is the new `verify`, so they keep their names.

_Alternative:_ leave internals alone and rename only the user surface. Rejected because `verifyOneRule` would then implement `validate` while `verifyCommand` implemented `verify`, the exact confusion the rename exists to remove.

### Public schema export: renamed, no alias

`./schemas` exports `verifyTestOutputSchema`, and it shipped in 0.12.0. It's renamed `ruleCheckOutputSchema`, and the old name is removed. This release is already breaking for every caller of these commands, and an alias would keep a name that encodes the old vocabulary in the public API. An importer gets a type error naming the missing export, which is a louder signal than a deprecation notice. The schema's shape doesn't change, so the fix is renaming the import. `verifyOutputSchema` (the layered `verifyRule()` result) keeps its name for the reason above.

### `taskless test` is removed, not aliased

It fails as an unknown command. The Cloud generator pins its CLI version, installed skills pin `install.cliVersion`, and `test` was a directive for agents rather than a command for users. An alias would keep the ambiguous name alive for another release.

### The `sg` engine parse is a scan of nothing

`validate` hands ast-grep the rule file alone with `-r <file>`, as `sg-fixture-findings.ts` and `sg-scope.ts` already do for their single-rule runs, and gives it no input to scan. No project config is assembled, so no other rule is parsed. A config error exits 8 with ast-grep's message on stderr, which becomes the rule's error. A clean load exits 0. The leading candidate is `sg scan -r <file> --stdin` with empty input. Whether every config error surfaces that way (an invalid `kind` is known to, from `sg-fixture-findings.ts`, which notes that a refused rule closes stdin early), and how long the call takes, will be measured against ast-grep 0.45.3 before writing it, as was done for `sg-scope`.

The parse runs only after the schema layer passes. A rule the schema already rejects would yield a second, worse message for the same defect.

### `verify`'s fixture run assembles only the target rule

`sg test` has no `-r` form and needs an `sgconfig.yml`, so `runTests` gets one written to a temporary directory naming only the rule under verification and its `.tests/` directory, instead of `assembleSgConfig(cwd)`. It's removed afterwards, matching the "writes nothing to disk" guarantee the findings collection already makes. `--filter` stays as a second guard. `check` keeps the project-wide assembly.

### Top-level `strictness` is a house constraint, not an engine refusal

ast-grep accepts the key and ignores it, so only our check can refuse it. It becomes `RULE_CONSTRAINTS` entry `sg-no-top-level-strictness`, `enforcedBy: "validate"`, so it is attributed with a `constraintId` and published in the corpus. The engine-parse refusal has no constraint behind it and carries none, consistent with "an error with no constraint behind it SHALL NOT be given one".

### Trap notices are decided over the parsed rule object

Each detector walks the parsed YAML: pattern strings (bare, or `context` in an object pattern), `follows`/`precedes` objects, and `has` relations with `field: function`. They emit through the existing `notices` list. Precision matters less than for a rejection, since a notice is never a failure, but each detector gets a test for the case it must stay quiet on. That includes `strictness: ast` present, `stopBy` present, an `await_expression` branch present, and a non-TypeScript language.

### `enforcedBy` and the corpus

`enforcedBy: "verify" | "test"` becomes `"validate" | "verify"`, with every entry mapped one to one (`verify` → `validate`, `test` → `verify`). `REFERENCE_VERSION` becomes 3, and `assets/reference.json` is regenerated, not hand-edited. The evaluator step text in `rules/reference.ts` names `taskless validate`, then `taskless verify`.

## Risks / Trade-offs

- **A missed mention keeps the old meaning silently.** Most dangerous is prose saying "run `verify`" that now runs fixtures where a reader expected a schema check. → The cross-reference test catches every `taskless <cmd>` and `agent <topic>` naming a missing command, and a final sweep greps for `verify`, `test` and `tested` in recipes, messages and specs, reading each hit. PR 1's description lists the sweep pattern so a reviewer can rerun it.
- **Pending changesets name `taskless test`.** `sg-empty-scope-notice.md` describes #487's notice under `taskless test`. Changesets publish as written, so the release notes would name a command the same release removes. → Edit those changesets to name `taskless verify`.
- **The engine parse adds a spawn per `sg` rule to `validate`.** → It is measured (see Decisions), and runs only after the schema passes. `sg-scope` measured a comparable spawn at about 65 ms over this repository.
- **The diff in PR 1 is large.** → Mechanical, in two commits that each have a checkable end state. The PR body states the size and the reason it is not split further.
- **Merge drift.** PR 1 touches nearly every recipe, so any recipe change that lands on `main` first conflicts. → Keep PR 1 short-lived, and rebase onto `main` immediately before it opens.

## Migration Plan

Consumers move by upgrading. The changeset (`minor`) tells a caller of `verify` that it now runs fixtures and that `validate` is the old meaning, tells a caller of `test` to call `verify`, and says the corpus `version` is 3, with `enforcedBy` values renamed. Rollback is pinning 0.12.
