## Why

`verify` and `test` ask two different kinds of question, and their names don't say which is which. Both read as "run the rule", so an agent can't tell from the name which one is the quick, deterministic answer it should loop on. The split also leaves real gaps, measured on `main` with ast-grep 0.45.3 (#489):

1. `verify` passes rules ast-grep refuses. `kind: readonly` gets `{"ok":true}`, and ast-grep exits 8 with ``Kind `readonly` is invalid``. The same is true of every keyword token and of Markdown inline kinds such as `link`. Zod can't catch this, because the valid kinds depend on the grammar and the binary can't list them. Only an engine parse can.
2. One broken rule fails another rule's tests, under the wrong name. With `kw/kw.yml` holding `kind: readonly`, `taskless test .taskless/rules/sg/inline` fails with `Cannot parse rule .taskless/rules/sg/kw/kw.yml`, reported under `inline`. `check` goes down with it.
3. A top-level `strictness: ast` passes `verify`, and ast-grep silently ignores it, so the pattern stays narrowed.

## What Changes

- **BREAKING** `taskless verify` is renamed `taskless validate`. It answers "is this rule well formed?" from the files alone, needs no fixtures, and certifies itself.
- **BREAKING** `taskless test` is renamed `taskless verify`. It answers "does this rule check what you want?" by running `validate` and then the fixtures, as `test` does today. The name `test` is removed outright, with no alias: callers pin their CLI version, and `test` was an agent directive rather than a user command.
- **BREAKING** An old caller of `taskless verify` now gets the new `verify`. That command runs `validate` first and keeps the same JSON envelope, so the old caller gets a stricter answer, not a different kind of output.
- **BREAKING** The `verify-rule` agent topic is renamed `validate-rule`. Every recipe that names either command is rewritten in the new vocabulary.
- The CLI's own messages that point at a command (for example the refusals printed by `check` and `rule delete`) name the new command.
- **BREAKING** The conformance corpus (`@taskless/cli/reference.json`) goes from `version` 2 to 3. Its `enforcedBy` values become `"validate" | "verify"`, and its evaluator steps name the new commands.
- **BREAKING** The `./schemas` export `verifyTestOutputSchema` is renamed `ruleCheckOutputSchema`, with no alias. The schema's shape is unchanged.
- `validate` gains the checks that only an engine parse or a house constraint can make (second PR of the stack):
  - one ast-grep parse of just this rule, which rejects any config error (invalid `kind`, unknown language, and so on) and reports it under that rule;
  - a top-level `strictness:` rejected as an error;
  - non-blocking notices for the heuristic quirks in `create-sg-rule`: `$$$` next to a comma in a pattern without `strictness: ast`, `follows`/`precedes` without `stopBy: end`, and a callee `regex` under `TypeScript`/`Tsx`.
  - `verify` (formerly `test`) runs an ast-grep rule's fixtures against a config holding only that rule, so another rule's config error can no longer fail it under the wrong name.
- Not changed: `check` still runs every `sg` rule through one assembled config, so one rule's config error still stops the `sg` report. `validate` now names that rule, and making `check` isolate it is a separate change.

### Delivery shape

**Stacked, merging forward**, two PRs. Each can reach production on its own:

1. **The rename.** Commands, the recipe topic, recipes, user-facing messages, `reference.json` v3, spec deltas, and the changeset (on this bottom PR). A release cut from this PR alone ships the new names with today's checks, which is coherent.
2. **The new `validate` checks**, with their specs and tests. This PR archives the change.

PR 1 will exceed the ~1200-line guideline. Almost all of it is a mechanical rename across recipes, specs and tests, and splitting it further would ship a release in which some recipes name commands that don't exist. Its PR body will say so.

The changeset is `minor` (0.13). Both commands shipped in `v0.12.0` (`latest` on npm), so a consumer crosses this change at a release boundary. The corpus carries its own compatibility signal in its `version` field, and the changeset body says so.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-rule-validation`: the two commands are renamed and their requirements restated under the new names. `validate` gains the engine parse, the top-level `strictness` rejection, and quirk notices. A config error is attributed to the rule that has it.
- `cli-agent-authoring`: authoring recipes direct the agent to `validate` and then `verify`.
- `cli-conformance-reference`: `enforcedBy` takes `validate | verify`, and the corpus version is 3.
- `cli-rule-format`: the canonical location is what `validate` and `verify` address.
- `cli-rule-routing`: the static recipe's dialect sentence names `validate`.
- `cli-rules`: the references to the top-level validation commands use the new names.
- `cli-runtime-rule-execution`: the fixture-execution gate belongs to `verify` (formerly `test`), and the capture check to `validate`.
- `cli-taskless-bootstrap`: the migration requirements that name `verify` name `validate`.
- `cli-vale-rule-engine`: the config-schema rejections are reported by `validate`.

## Impact

- **Code**: `commands/verify.ts`, `commands/names.ts`, `src/index.ts`, `rules/inspect.ts`, `rules/verify.ts`, `rules/constraints.ts`, `rules/reference.ts`, `schemas/verify-test.ts`, `schemas/index.ts`, `prompts/index.ts`, and every message that names a command (`check`, `rule delete`, migrations, notices).
- **Recipes**: `verify-rule` (renamed), `create-sg-rule`, `create-vale-rule`, `create-runtime-rule`, `create-remote-rule`, `improve-rule` (both variants), `rule`, `update`, `init`, `route`.
- **Published artifacts**: `assets/reference.json` (v3) and the `./schemas` export name.
- **Repository**: the `no-unrouted-cli-invocation` house rule (it names `schemas/verify-test.ts`), `.github/workflows/demo-rule.yml`, `example/README.md`, and about 30 test files.
- **Consumers**: the Cloud generator pins its CLI version and moves when it upgrades. Installed skills pin `install.cliVersion`, and the upgrade rewrites the skill along with the CLI.
- **Gap 2 fix** changes how `verify` assembles the ast-grep config for a fixture run (`rules/assemble.ts`, `rules/verify.ts`). `check`'s assembly is untouched.
