## Context

`0004` partitioned `.taskless/` by engine: `sg/rules` + `sg/rule-tests`, `vale/rules` + `vale/rule-tests`, `runtime/rules` + `runtime/rule-tests`. Vale additionally carries a single committed `.vale.ini` where every rule declares its scope, with `tskl) <name> = <value>` breadcrumbs so tooling can find which matchers belong to which rule.

`agent-command-and-vale-authoring` then wrote the Vale authoring recipe and executed it five times against sandboxed agents with no repository access. Every silent failure those runs found was in the shared config, and the recipe grew a debug ladder whose first four rungs are all "did you edit the shared file correctly".

Everything below rests on measurement against the bundled ast-grep 0.41.0 and Vale 3.17.1.

**ast-grep**

- `ruleDirs` **recurses**, and every `.yml`/`.yaml` beneath is parsed as a rule. A `tests/` directory inside a rule directory fails the whole run with `Fail to parse yaml as RuleConfig: missing field 'language'`.
- `__tests__/` fails the same way. A **dot-directory is skipped**: `.tests/` inside a rule directory leaves `sg scan` clean.
- `sg test` reads `testDir: <rule>/.tests` normally and writes snapshots to `<rule>/.tests/__snapshots__/`.

**Vale**

- `rules/<id>/<id>.yml` resolves as check `<id>.<id>` under `StylesPath` pointing at the rules tree; under `StylesPath = .` it resolves to nothing.
- Unknown top-level keys in a style are rejected (`E201 has invalid keys`), so scope cannot ride inside the style file.
- A `.yml` sidecar inside a style directory is loaded as a rule and fails `E201` when the style is enabled wholesale; a non-`.yml` file is ignored. A `.tests/` directory is harmless even when it contains a `.yml`.

**runtime**

- Discovery reads the rule directory non-recursively for `*.yml`, so any subdirectory is already invisible to it.

## Goals / Non-Goals

**Goals:**

- One directory per rule, the same shape for every engine, so "where is this rule" has one answer.
- No file written by more than one rule's author.
- A rule addressable by path, so `verify`/`test` need no id lookup and no ambiguity rule.
- Silent-disable failure modes removed by construction rather than documented.

**Non-Goals:**

- Supporting both layouts. There is one legal shape; `0005` moves projects to it.
- A writer for rule configs. The agent authors every committed file; assembly only concatenates.
- Changing what any engine can express. This is where files sit, not what rules do.

## Decisions

### D1 — One rule, one directory, every engine

```
.taskless/rules/sg/no-eval/
    no-eval.yml
    .tests/no-eval-20260101-test.yml

.taskless/rules/vale/no-simply/
    no-simply.yml
    .vale.ini
    .tests/pass/ok.md
    .tests/fail/bad.md

.taskless/rules/runtime/unused-exports/
    check.ts
    captures/exported-symbol.yml
    .tests/…
```

The engine is a path segment, so it is still read from position and never from content — the rule `dispatch` already follows. What changes is that a rule is now **one** path rather than two, which is what makes `verify <path>` and `test <path>` possible without an id lookup.

_Alternative rejected:_ mirrored `rules/` and `tests/` trees. Uniform and requires no cleverness, but a rule is two paths again, which is the thing being fixed.

### D2 — Tests live in `.tests/`, and the dot is load-bearing

`.tests/` rather than `tests/` because ast-grep's `ruleDirs` recurses and parses every `.yml` beneath as a rule. Measured, `tests/` and `__tests__/` both hard-fail the scan; a dot-directory is skipped, and `sg test` still reads it when `testDir` names it.

This is a dependency on undocumented behavior and should be recorded as one. Three things make it acceptable:

- **The failure is loud.** If ast-grep stops skipping dot-directories, the scan fails with a parse error naming the file. It does not silently reinterpret a test as a rule, and it does not silently disable anything.
- **A test pins it.** A fixture with a rule directory containing `.tests/` asserts the scan stays clean, so the assumption is checked on every run rather than remembered.
- **The binary is version-pinned.** `@ast-grep/cli` and every platform package are pinned to an exact version (`0.41.0`), not a range, so this behavior cannot change under a project without a deliberate dependency bump. That bump is where the pinning test fires, which makes the discovery a migration task with a changelog to read rather than a mystery in someone's CI.

The cost is real: dot-prefixing hides tests from a casual `ls`, and tests are the part of a rule most worth reading.

_Alternative rejected:_ materialize a rules-only tree and point `ruleDirs` at it, keeping a plain `tests/`. It reaches the same authored layout with no undocumented dependency, and there is precedent — runtime already materializes `.taskless/.run/`. It was rejected for cost: a third assembly step, plus rule paths in ast-grep's own diagnostics pointing at a generated copy rather than the file the author edits. Worth revisiting if the dot-directory assumption ever breaks.

### D3 — Per-rule configs, assembled per run, gitignored

Vale accepts exactly one `--config`, and ast-grep one `sgconfig.yml`, so per-rule configuration has to reach a single file before either tool can be invoked. The committed source of truth is per-rule; the file handed to the tool is assembled and gitignored — the same treatment the ephemeral `sgconfig.yml` already receives.

**Assembly order is a correctness constraint.** Vale's precedence is positional: across matchers the last wins, within one matcher the first assignment wins. Assembly SHALL therefore be deterministic — rules ordered by id, each rule's own matcher order preserved verbatim — or a rule's effective scope would depend on directory iteration order.

A consequence worth stating: a rule cannot override another rule's matchers, because it cannot know its position. That is the coupling per-rule configs remove.

_Alternative rejected:_ invoke the tool once per rule. Vale takes one `--config`, so N rules is N process spawns per check and N JSON payloads to merge.

_Alternative rejected:_ commit the assembled file. It is the shared write-contended file again, arriving by a different route.

### D4 — No per-rule config for ast-grep

Vale needs a per-rule config because its scoping cannot live in the style file — measured, `E201`. ast-grep's scoping (`files`, `ignores`) lives *in* the rule, so the equivalent slot has nothing to hold.

An empty `sg-config` per rule would be symmetry as decoration: a file every author must create, no author ever fills, and every reader must learn to ignore. The symmetry that does hold is one level up — both engines' project configs are assembled and gitignored.

### D5 — `StylesPath` follows the layout

`StylesPath` points at the Vale rules tree so each rule directory is a style, giving check name `<id>.<id>`. This is not a free choice: under `StylesPath = .` a nested rule file resolves to nothing at all.

It reverses the note in `0004`, which calls `StylesPath = rules` wrong. That was correct **for the flat layout**, where pointing StylesPath at `rules/` makes each rule file a style directory with no rules in it and every check silently resolves to nothing. The same setting is right for one layout and silently wrong for the other, so the note must be rewritten rather than deleted — a future reader who finds it will otherwise "fix" it back.

### D6 — `verify` and `test` are separate, and `verify` is a layer of `test`

`verify <path>` answers "is this a well-formed rule"; `test <path>` answers "does it behave". They split because their preconditions differ: an agent mid-authoring has a rule and no tests yet, and needs the first before it can write the second.

`test` runs `verify` first and stops on failure. Today the composition is backwards — fixture coverage short-circuits before Vale parses the rule, so a rule with an invalid `level` and a half-written fixture set reports `fixtures: "fail-only"` and never surfaces `'level' must be one of [suggestion warning error]`. The error the author needs is hidden behind the one they do not.

### D7 — Paths, not ids

A path names one thing; an id does not. The same id can exist under `sg` and `vale`, which is why the id-addressed command needed an ambiguity error at all. Removing the addressing scheme removes the error case.

_Alternative rejected:_ keep `rule verify <id>` as an alias. It preserves the ambiguity case to save typing, in a command invoked from a recipe that can carry a path just as easily.

### D9 — The legacy read paths are removed, not renamed

`.taskless/rules/` is the new root. It is also `LEGACY_RULES_DIRECTORY`, the pre-`0004` flat location — the same string, now meaning something else. Found while implementing: the two collide exactly.

The legacy read paths are removable rather than renameable because they are unreachable. `ensureTasklessDirectory` runs migrations before anything reads a rule, so `0004` has already moved `.taskless/rules/*.yml` to `sg/rules/`, and `0005` moves it again. A "legacy" lookup under the new layout would resolve `.taskless/rules/<id>.yml` inside a tree whose real contents are `rules/<engine>/<id>/` — reading the new root as if it were the old flat directory.

So `LEGACY_RULES_DIRECTORY` and `LEGACY_RULE_TESTS_DIRECTORY` go, along with their readers in `verify.ts`, `detect/scan.ts`, and `commands/rules.ts`. Their error messages, which name the legacy path as a place a rule might be, go with them.

_Alternative rejected:_ keep them under a new constant name. It preserves a fallback for a state migrations guarantee cannot exist, and the fallback would now point into the live tree. A stale read path that resolves to a real directory is worse than no fallback.

### D8 — `captures/`, not `matchers/`

Runtime's ast-grep capture rules move to `captures/`. "Matcher" now has a precise meaning in the Vale spec — a `[<glob>]` ini section — and one word for two unrelated concepts in one `.taskless/` tree is a cost paid at every future reading.

## Risks / Trade-offs

- **The dot-directory assumption is undocumented** → mitigated by a loud failure mode, a pinning test, and an exact version pin on the binary, so a change arrives with a deliberate upgrade rather than silently (D2). Materialization is the recorded fallback.
- **Assembly is a new failure surface** → a bug there disables rules silently, which is the failure this engine's design exists to prevent. Mitigated by asserting the assembled artifact byte-for-byte and asserting stability across runs.
- **Two migrations touch the same tree in one stack** → `0004` and `0005` are both unreleased and both in this stack, so every consumer runs them as one upgrade and never observes the intermediate layout. The risk is to this repository's own fixtures, which tests cover.
- **The recipe changes again** → `create-vale-rule` teaches the flat layout in detail and its nine worked rules were verified against it. The rule bodies are unaffected; only where the file sits and where scope is declared. The 2b harness re-runs against the new text.
- **Tests are less visible** → dot-prefixing hides the part of a rule most worth reading. `example/` exists partly to counteract this by showing a full rule directory in a place nothing hides.

## Migration Plan

`0005` layers on `0004`; neither is released, and both ship in this stack, so consumers run them as a single upgrade.

0. Note that `0004` has already emptied `.taskless/rules/` by moving it to `sg/rules/`, so the new root is free before `0005` writes into it. `0005` SHALL assert this rather than assume it: a top-level `*.yml` still sitting in `.taskless/rules/` means `0004` did not complete, and writing engine directories around it would interleave two layouts in one tree.
1. Move `<engine>/rules/<id>.yml` → `rules/<engine>/<id>/<id>.yml`; for runtime, `runtime/rules/<id>/` → `rules/runtime/<id>/` with its `*.yml` capture rules into `captures/`.
2. Move `<engine>/rule-tests/<id>*` → `rules/<engine>/<id>/.tests/`, preserving each engine's internal test shape.
3. Split the committed `vale/.vale.ini`: each matcher carrying `tskl) rule = <id>` moves into that rule's own `.vale.ini`.
4. A matcher with **no** `tskl) rule` breadcrumb cannot be attributed. Leave it and report it rather than guessing an owner or dropping it — an unattributable matcher is a user's hand edit, and discarding it silently changes what their check reports.
5. Delete the committed `vale/.vale.ini` and `sg/sgconfig.yml`; gitignore both assembled paths.
6. Content is preserved byte-for-byte throughout: runtime capture bytes determine server-side reconciliation hashes, so a rewrite would invalidate every signature.

## Open Questions

- None outstanding.
