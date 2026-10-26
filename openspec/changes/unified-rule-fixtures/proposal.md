## Why

Each engine tests its rules a different way. ast-grep reads `valid:`/`invalid:` snippets from a test YAML and judges them with `sg test`, then scans the same snippets a second time over stdin to recover the rendered messages. Vale lints flat fixture documents under a config that enables the rule everywhere (`[*]`). Runtime hands a case directory to the harness. None of the static paths is the one `check` runs. The stdin scan bypasses `files:`, and the Vale config throws away the rule's own matchers. So a rule whose scope never matches a real file passes `verify` and reports nothing in `check`: the silent-success failure this project keeps meeting. Vale 3.24 now ships its own in-rule test format too, and treating each engine's test format as authoritative would add a fourth layout.

One layout for every engine, judged by the same invocation `check` makes, gives a single fixture loop and closes the scope gap. It also leaves less to go wrong, because the code that verifies a rule is the code that runs it.

## What Changes

- **BREAKING (layout):** a rule's fixtures move from `.tests/` to `tests/`, and every engine uses one shape: `tests/pass/<case>/` and `tests/fail/<case>/`, where a case is a directory named for what it shows.
- `verify` judges each case by running the engine's own check with the case directory as the root. A `fail/` case passes on at least one finding for the rule, and a `pass/` case passes on none. Scope applies: ast-grep `files:`/`ignores:` and the matchers in the rule's own `.vale.ini`.
- When a `fail/` case stays quiet, verify runs it again with scope removed. If it fires then, the error says the rule's scope excluded the fixture.
- **REMOVED:** `sg test` as the ast-grep verdict, and the stdin re-scan that collected ast-grep fixture findings. Findings now come from real files, so their paths and positions are native.
- ast-grep reads its rules from a rules-only tree assembled in the run directory, so `ruleDirs` never walks into `tests/`. Measured on 0.51.0, a plain `tests/` inside `ruleDirs` still fails the whole scan.
- Scaffold migration 12 converts existing fixtures. ast-grep snippets become case files, using a fixed language → extension table and a path that the rule's `files:` globs accept. Vale documents each become a case directory. Runtime cases are only renamed. Anything the migration cannot convert stays where it is, and the migration names it.
- The Vale 3.24 `tests:` → fixtures rule migration writes into the new layout.
- Rule delivery reads a service response in the old fixture format and migrates it just in time, through the same converter migration 12 uses, before anything is written. Fixtures carry no signature, so converting them changes no signed byte. The CLI therefore depends on no change from the Cloud service, now or later.
- Reconcile and delivery exclude `tests/` from signing the same way they exclude `.tests/` today.
- The authoring recipes share one fixture-writing section, which covers recreating the path a scoped rule expects. The per-engine recipes point at it.
- The conformance corpus and the published layout report one grouping, `case-directories`, for every engine.

## Delivery shape

**Stacked, merged atomically with `gh stack merge`.** The directory rename, the runners that read it, migration 12 and delivery's conversion are only correct together, so they share one layer; a CLI that verifies `tests/` while delivery still writes `.tests/` would ship a broken state. Everything that is correct on its own goes in a layer below it: the rules-only ast-grep tree, the fixture converter and the engine behavior pins. Every layer is green on its own, because a stack merge is all-or-nothing and one red layer blocks the whole stack. The nightly carries it, and the release (0.13.4) follows when it is ready. Nothing waits on Cloud, because delivery migrates the old format just in time. One `patch` changeset sits on the bottom branch, since the package is pre-1.0. Its body tells consumers about the layout move.

## Capabilities

### New Capabilities

- `cli-rule-fixtures`: the engine-independent fixture contract: the case-directory layout, judging a case through the engine's own check, scope applying to fixtures, the unscoped diagnosis, and what in `tests/` is refused.

### Modified Capabilities

- `cli-rule-validation`: verify's fixture scenarios move to case directories for every engine. The ast-grep-specific findings requirement is removed, because the unified runner covers it.
- `cli-vale-rule-engine`: Vale fixtures are case directories and are verified under the rule's real scope. The self-contained directory names `tests/`.
- `cli-runtime-rule-execution`: the fixture paths and exclusions name `tests/`.
- `cli-rule-format`: the rule directory table, the dot-prefix rationale (replaced by the rules-only tree), and the assembled ast-grep config.
- `cli-conformance-reference`: every engine publishes `case-directories` with an explicit case list.
- `cli-generated-rule-delivery`: unsigned fixtures live under `tests/`, and a response in the old fixture format is migrated just in time on write.
- `cli-rule-reconciliation`: `tests/` is the unsigned, unreported fixture directory.
- `cli-rules`: create and delete name `tests/`.
- `cli-agent-authoring`: the Vale recipe's fixture artifact, plus a shared fixture section every authoring recipe uses.
- `cli-taskless-bootstrap`: migration 12.

## Impact

- **Code:** `rules/layout.ts` (`RULE_TESTS_DIRECTORY`, `FixtureLayout`), `rules/verify.ts`, `rules/sg-fixture-findings.ts` (deleted), `rules/vale/verify.ts`, `rules/runtime/fixtures.ts`, `rules/fixtures.ts`, `rules/assemble.ts`, `rules/scan.ts`, `rules/deliver.ts`, `rules/reference.ts`, reconcile signing, `filesystem/migrations/` (new `0012`), `rules/rule-migrations/vale-3-24-0-tests-to-fixtures.ts`, the agent recipes under `src/agent/`.
- **Published surface:** `@taskless/cli/layout` (`RULE_TESTS_DIRECTORY`, `fixtureLayout`) and `reference.json` (`tests.grouping`). The Cloud generator builds payloads against both.
- **Cross-team:** none required. The service may keep emitting `.tests/` indefinitely, and delivery migrates it. Cloud is told about the new layout and corpus version so that it can move when it wants to.
- **Users:** the scaffold version bump makes a pinned older CLI refuse a migrated project with `SCAFFOLD_VERSION_MISMATCH`, which is what a layout change means. This repository's own `.taskless/rules/` migrate as part of the change.
