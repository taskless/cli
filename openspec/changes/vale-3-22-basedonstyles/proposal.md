## Why

Vale 3.22.0 gives an empty `BasedOnStyles` a meaning (upstream c2d62437): it clears every setting a file inherited from an earlier matcher. The `create-vale-rule` recipe has told every author to write `BasedOnStyles =` in every matcher since the Vale engine shipped, on the belief that it kept bundled styles from loading, and the assembled run config is every rule's matchers interleaved in id order. Measured on the 3.22.0 binary against the exact layout `assembleValeConfig` writes: a rule writing the line under `[docs/**]` silences every alphabetically earlier rule under `docs/`; `[*.md]` beside another rule's `[*.{md,markdown}]` silences the first on every `.md` file; and a rule's own later `[docs/**]` matcher carrying only the line turns the rule off there. Nothing is reported. Only two rules whose globs are byte-identical escape, because Vale merges those into one section, which is the only reason this repository's own five rules did not notice. On 3.21.0 every one of those configs fired both rules.

The belief the line rested on was also wrong. Measured on both binaries with a document baited for `Vale.Spelling`, `Vale.Repetition` and `Vale.Terms`: nothing but the rule under test fires when the key is absent, and the control (`BasedOnStyles = Vale`) fires all of them. No bundled style loads unless a run-level `BasedOnStyles` names one, and the assembled header names none.

## What Changes

- **The config schema rejects `BasedOnStyles` in a rule's config with any value**, under `vale-config-no-based-on-styles` (renamed from `vale-config-based-on-styles-empty`, which accepted the empty form; the id was never published in a release, so the rename is free). The message says what the line does on the pinned Vale and to delete it.
- **Migration 8 deletes the line** from every `.taskless/rules/vale/<id>/.vale.ini`, and nothing else: a line edit over the author's own bytes, never a parse and re-serialize, anchored on the key at line start so a comment survives, idempotent, and skipping a file without the line. `check` and `verify` refuse to run on a scaffold behind the current version and name `init`, which applies it; `init`, `demo`, `onboard`, the wizard and rule delivery run migrations directly.
- **The three isolating configs** (`buildIsolatingConfig`, the generator's `probe()`, `runOne` in the schema contract test) stop writing `BasedOnStyles =`, and their docblocks now carry the measurement instead of the belief.
- **Every fixture, corpus config, the demo asset and the recipe template drop the line.** The recipe explains why the key is rejected; the `update` ledger tells a project what `init` rewrites and that `verify` names anything left.
- **The 3.22.0 contract is pinned** in `vale-vendor-contract.test.ts` on the assembled layout: the `BasedOnStyles` table above, `UNSET`, that no bundled style loads without the key, negated inline scopes (`~link`, `~strong`, `~emphasis` blank the element's text out of the block; `text.raw` and `paragraph.link` from the release note are not operands), `[formats]` by file name and glob (and that the schema refuses a `[formats]` section in a rule config), front-matter placement, a rule file's `message` and `description` being the only prose in it, a one-line MDX element, and `split: true`. `VALE_VERSION` moves to 3.22.0 and the vocabulary is regenerated (unchanged beyond the stamp).

## Delivery shape

**Single PR**, merging down into the bot's pin-bump branch `vendor/vale/upgrade` (taskless/cli#368). The pin bump alone does not land green (`VALE_VERSION` disagrees with the pins) and, worse, would ship the silencing above to every project with two Vale rules on different globs; the schema rejection alone would turn every project's `check` red until someone deleted the lines by hand. Pin, rejection and migration are correct only together, so they reach `main` atomically through the bot's branch.

Nothing here is **BREAKING**, and the bump is `patch`. A rule that carried the key is rewritten by the migration to a config that enables exactly what it enabled on 3.21.0, and a rule copied in afterwards with the key fails `verify` naming the line, where on 3.22.0 without this change it would have silenced a neighbour silently.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-vale-rule-engine`: "Per-rule scoping is expressed in the rule's own Vale config" states that a rule's config carries no `BasedOnStyles` and why, with a scenario for overlapping matchers and one for the refusal; "A rule's Vale config is validated against a schema before it is assembled" moves the key from "must be empty" to "rejected with any value" and adds the `[formats]` scenario.
- `cli-rule-validation`: "Verify checks a rule's required components" gains the rejection scenario.
- `cli-taskless-bootstrap`: a new requirement for migration 8.

## Impact

- `packages/cli/src/schemas/vale-config.ts`, `src/rules/constraints.ts`, `assets/reference.json` (regenerated).
- `packages/cli/src/filesystem/migrations/0008-drop-based-on-styles.ts` (new), registered in `migrate.ts`; `LATEST_SCHEMA_VERSION` becomes 8 and this repository's own `.taskless/` is migrated and committed.
- `packages/cli/src/rules/vale/verify.ts`, `scripts/generate-vale-schema.ts`, `test/vale-schema-contract.test.ts`: isolating configs.
- `packages/cli/src/rules/capabilities.ts` (`VALE_VERSION`, the bump note in the tier table), `src/generated/vale-vocabulary*` (regenerated), `src/rules/assemble.ts` (docblock).
- `packages/cli/src/agent/create-vale-rule.md` (topic v11), `src/agent/update.md` (topic v9), `.changeset/vale-3-22-0.md` (grown in place).
- Tests: the schema fixture set, the constraint table, migration tests, the corpus, the vendor contract's new `Vale 3.22.0` block, and every inline config in the suite that carried the line.
