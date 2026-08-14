## Why

A Vale rule is currently spread across three locations, one of which every rule in the project shares. The style file is `vale/rules/<id>.yml`, the fixtures are `vale/rule-tests/<id>/`, and the scope — the part that decides whether the rule runs at all — is a matcher inside the single committed `vale/.vale.ini`.

That shared file is the problem. Every agent authoring a rule has to edit it correctly, in a file every other rule also occupies, and the failure is silent: an assignment outside a matcher is ignored with a warning on stderr, a glob that misses the fixture's extension lints nothing, and a rule whose three names disagree simply never runs. Five sandboxed harness runs against `create-vale-rule` found silent failures in exactly this step and nowhere else. At any scale — hundreds of agents, or one agent and a year of rules — a single write-contended config is the wrong shape.

Making each rule self-contained removes the class rather than documenting it. It also makes a rule addressable as one path, which is what lets `verify` and `test` take a path instead of an id.

Now, because no Vale rules exist yet. Once they do, this is a migration.

## What Changes

- **BREAKING** A Vale rule becomes a directory, `.taskless/vale/rules/<id>/`, holding its style file `<id>.yml` and its own `.vale.ini` carrying that rule's matchers, exclude directives, and `tskl)` metadata.
- **BREAKING** `.taskless/vale/.vale.ini` stops being committed. `check` assembles it from the per-rule configs at run time, and it is gitignored — the same treatment the ephemeral `sgconfig.yml` already gets.
- **BREAKING** `StylesPath` becomes `rules`, which is what makes each rule directory a Vale *style*. Measured: `rules/<id>/<id>.yml` resolves as check `<id>.<id>` under `StylesPath = rules`, and resolves to nothing under `StylesPath = .`.
- **BREAKING** `rule verify <id>` is removed, along with its id-based engine dispatch. An id is not a unique address — the same id can exist under `sg` and `vale` — so addressing by id required an ambiguity error that the path form does not need.
- Two new path-addressed commands: `verify <path>` checks a rule has its required components, `test <path>` runs its fixtures. Both accept a file or a directory; a directory means everything beneath it. Both run as part of the rule generation loop.
- `verify` becomes a prerequisite layer of `test`, so a malformed rule reports its own error instead of a fixture complaint. Today a rule with a bad `level` and an incomplete fixture set reports `fixtures: "fail-only"` and never surfaces `'level' must be one of [suggestion warning error]`.
- `create-vale-rule` is rewritten against the new layout, and its worked examples re-verified against it.
- A committed example project at `<root>/example` — a README, an HTML and a CommonJS file, and a `.taskless/` holding one Vale rule and one ast-grep rule with their fixtures. It is a demo of a correct layout and a smoke test for `check`, `verify`, and `test`, exercised by a test so it cannot rot silently.

## Capabilities

### New Capabilities

- `cli-rule-validation`: the path-addressed `verify` and `test` commands — how a path resolves to an engine, what each command checks per engine, and how they compose in the generation loop.

### Modified Capabilities

- `cli-vale-rule-engine`: the rule is a directory with its own config; the run config is assembled and gitignored rather than committed; `StylesPath` changes; matcher precedence now has to be preserved across an assembly step rather than within one authored file.
- `cli-rule-format`: the canonical on-disk shape of a Vale rule, and the "committed native config, never generated" rule that a Vale run config now breaks.
- `cli-agent-authoring`: `create-vale-rule` teaches the new layout and names `verify`/`test`. **This capability is introduced by `agent-command-and-vale-authoring` (PR #102) and is not yet in `openspec/specs/`**, so this delta modifies a requirement that only exists once #102 archives — expected for a stacked change, and the reason `openspec validate` will flag it until then.

## Impact

- `src/filesystem/migrations/` — a new migration moving any flat `vale/rules/<id>.yml` into `vale/rules/<id>/<id>.yml`, and retiring the committed `vale/.vale.ini`. Migration `0004` is unreleased, so no project in the field carries the old scaffold.
- `src/rules/vale/run.ts` — assembles the run config instead of reading a committed one.
- `src/rules/vale/verify.ts` — a rule's config is now its own; the isolating config used for verification is built from it rather than invented.
- `src/rules/dispatch.ts` — `hasValeRules` currently looks for flat `*.yml` and would report a directory-shaped rule set as "no rules configured".
- `src/commands/rules.ts` — `rule verify` removed; `src/commands/` gains `verify` and `test`.
- `src/help/create-vale-rule.txt` — rewritten; `verify-rule.txt` and every recipe naming `rule verify`.
- `.taskless/.gitignore` — the assembled config.
- `<root>/example/` — new, plus the root tooling ignores (prettier, eslint) that would otherwise walk its deliberately-wrong fixture prose.
- Reverses the `.vale.ini`-writer non-goal recorded in `agent-command-and-vale-authoring/design.md`, which assumed a hand-authored shared config.
