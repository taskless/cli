## Why

A rule is spread across locations today, and for Vale one of them is shared by every rule in the project. The style is `vale/rules/<id>.yml`, the fixtures are `vale/rule-tests/<id>/`, and the scope — the part deciding whether the rule runs at all — is a matcher inside the single committed `vale/.vale.ini`.

That shared file is where the failures are. Five sandboxed harness runs against `create-vale-rule` found silent failures in that step and nowhere else: an assignment above the first matcher, a glob that missed the fixture's extension, three names that had to agree with nothing reporting when they didn't. A single write-contended config is the wrong shape whether it is hundreds of agents or one agent and a year of rules.

The same reasoning generalizes past Vale. `sg` and `runtime` rules are also split between a `rules/` tree and a parallel `rule-tests/` tree, so no engine has a single path that means "this rule". Fixing Vale alone would leave three layouts to reason about instead of one.

Now, because no Vale rules exist yet and `0004` is unreleased. Once either is true in the field, this is a migration with users attached.

## What Changes

- **BREAKING** One directory per rule, identical across engines: `.taskless/rules/<engine>/<id>/`, holding the rule, any config that engine requires, and its tests in `.tests/`.
- **BREAKING** A Vale rule carries its own `.vale.ini` with its matchers, exclude directives, and `tskl)` metadata. `check` assembles the run config from every rule's config and gitignores the result.
- **BREAKING** `sgconfig.yml` becomes assembled and gitignored too, pointing `ruleDirs` at the rules tree and `testConfigs` at each rule's `.tests/`.
- **BREAKING** `StylesPath` becomes `rules/vale`, which is what makes each rule directory a Vale *style*. Measured: `<id>/<id>.yml` resolves as check `<id>.<id>` under that StylesPath and resolves to nothing under `StylesPath = .`.
- **BREAKING** `rule verify <id>` is removed. An id does not name one thing — the same id can exist under two engines — so the id form needed an ambiguity error the path form does not.
- Two path-addressed commands: `verify <path>` checks a rule has its required components, `test <path>` runs its tests. Both accept a rule directory or any directory above it, and both run in the rule generation loop.
- `verify` becomes a prerequisite layer of `test`, so a malformed rule reports its own error instead of a fixture complaint.
- Runtime's capture rules move to `captures/`, freeing "matcher" to mean one thing — a Vale `[<glob>]` ini section.
- `create-vale-rule` is rewritten against the layout and its worked examples re-verified.
- A committed `example/` project — README, an HTML and a CommonJS file, and a `.taskless/` with one Vale rule and one ast-grep rule — so a reader can see an install rather than infer it from tests that build their own fixtures.

## Capabilities

### New Capabilities

- `cli-rule-validation`: the path-addressed `verify` and `test` commands — how a path resolves to an engine, what each checks per engine, and how they compose in the generation loop.

### Modified Capabilities

- `cli-rule-format`: the canonical on-disk shape of every rule, the engine-per-directory rule, and the "committed native config, never generated" requirement that an assembled config now breaks.
- `cli-vale-rule-engine`: the rule is a directory with its own config; the run config is assembled and gitignored; `StylesPath` changes; matcher precedence must survive an assembly step.
- `cli-agent-authoring`: `create-vale-rule` teaches the layout and names `verify`/`test`. **This capability is introduced by `agent-command-and-vale-authoring` (PR #102) and is not yet in `openspec/specs/`**, so this delta modifies a requirement that exists only once #102 archives — expected for a stacked change.

## Impact

- `src/filesystem/migrations/0005-*` — layers on `0004` rather than replacing it. Both are unreleased and both are in this stack, so every consumer runs them as one upgrade and never observes the intermediate layout.
- `src/rules/engines.ts` — `ENGINE_LAYOUTS` becomes one rule-directory rule plus per-engine contents.
- `src/rules/vale/run.ts`, `verify.ts` — assembly; the isolating verify config derives from the rule's own.
- `src/rules/dispatch.ts` — `hasValeRules` looks for flat `*.yml` and would read a directory-shaped rule set as "no rules configured".
- `src/filesystem/sgconfig.ts` — assembled rather than committed.
- `src/rules/runtime/discover.ts` — capture rules move to `captures/`.
- `src/commands/rules.ts` — `rule verify` removed; new `verify` and `test` commands.
- `src/help/create-vale-rule.txt`, `verify-rule.txt`, and every recipe naming `rule verify`.
- `.taskless/.gitignore` — the two assembled configs.
- `example/` — new, plus the root tooling ignores that would otherwise walk its deliberately-wrong fixture prose.
- Reverses the `.vale.ini`-writer non-goal in `agent-command-and-vale-authoring/design.md`, which assumed a hand-authored shared config.
