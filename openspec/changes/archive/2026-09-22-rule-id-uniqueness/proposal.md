## Why

Nothing keeps `.taskless/rules/sg/no-eval/` and `.taskless/rules/vale/no-eval/` from both existing. `isValidRuleId` is `/^[a-z0-9][a-z0-9-]*$/`, with no engine component and no cross-engine check; the write path resolves one engine and `mkdir`s inside it; the read path asks `listRuleIds` per engine and never diffs the answers. `findRuleEngines` already returns every engine holding an id, and its docblock already says the uniqueness the old code assumed was never true of the ids this CLI accepts.

The damage is not hypothetical and does not need anyone to run `check`. `writeRuleMetaFiles` keys `.taskless/rule-metadata/{id}.yml` on the id alone, so two colliding rules share one sidecar: the second `rule create` or `rule improve` overwrites the first's metadata silently, `rule meta <id>` returns the wrong rule's, and `deleteRuleFiles` removes the shared file for whichever rule is deleted first, leaving the survivor without one. Human `check` output cannot tell the two apart either, because `util/format.ts` prints `severity[ruleId]` with no engine. The JSON envelope is fine: every result carries `source`.

## What Changes

- **`verify` fails a rule whose id is held by more than one engine**, naming every holding directory and the shared metadata sidecar, and telling the user to rename one. The check is **per rule**, not only project-wide: `verify` runs on a single rule as well as on the tree, and verifying the rule an author just wrote is the moment the collision is cheapest to fix. The project-wide form falls out of running it for each rule. `test` inherits it, because `test` runs `verify` first.
- **The failure is not a `RULE_CONSTRAINTS` entry.** Every constraint is declared for one `engine` and published per engine in the conformance corpus, because a constraint says what this CLI requires of a rule for that engine beyond what the engine itself requires. This requires nothing of the rule: the file is valid, and what is wrong is that a sibling tree holds the same directory name. Giving it an engine would mean inventing an engine-agnostic constraint kind for one entry, or filing three near-identical ones and telling a generator that ast-grep has a house rule about Vale. It is reported in `errors` with no `violations` attribution, the same way every other non-engine finding already is.
- **The wording matches `rules delete`.** `rules delete` refuses the same state with `RULE_ID_AMBIGUOUS` and "Rule … is held by N engines, so there is no single rule to delete: <paths>". The opening clause is shared verbatim and only the consequence differs, so the two surfaces cannot come to describe one condition as two.
- **`writeRuleFile` warns and still writes.** `check`'s repair path calls it, so a refusal would brick repair for both colliding rules — strictly worse than the silence it would replace. The failure belongs in `verify`, which is what the warning points at.
- **Migration `9` detects and refuses, and never renames.** Nothing there can tell which rule should keep the id, and a rename is not local: the sidecar, the rule's `.tests/` fixtures and the server-side id all reference the old name, so an automatic rename would pick one at random and break the references of whichever it moved. It is read-only in every case and idempotent. `LATEST_SCHEMA_VERSION` becomes 9 and this repository's own `.taskless/taskless.json` is bumped with it.
- **The refusal composes with `SCAFFOLD_MIGRATION_REQUIRED` rather than looping with it.** `check` and `verify` refuse a stale scaffold by naming `init`, and `init` is what runs migrations. A refusal that only reported the collision would send the user straight back to `init`, which would refuse again. It names the rename to perform _before_ re-running `init`, and reports `RULE_ID_AMBIGUOUS` so an agent that has learned what to do with `rules delete`'s refusal has learned what to do with this one.

Deliberately out of scope, per taskless/cli#387: whether the metadata sidecar should gain an engine segment, and whether `check --rule <id>` should stop selecting both engines. The filter over-selects rather than mis-selects, its findings carry `source`, and once `verify` refuses the collision the case stops arising.

## Delivery shape

**Single PR.** The `verify` failure and the migration are one behavior seen from two moments, and shipping either alone is wrong in a way the other fixes: the check without the migration only ever fires for rules written after it, while a project that already collides keeps sharing a sidecar; the migration without the check walls off existing projects for a condition nothing else reports. The diff is small enough to review whole, and the spec, implementation and archive land together.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-rule-validation`: a new requirement for the per-rule uniqueness refusal; "Rules are validated and tested by path, not by id" restated so its cross-engine scenario says what addressing still guarantees and what `verify` now reports.
- `cli-taskless-bootstrap`: a new requirement for migration 9.

## Impact

- `packages/cli/src/rules/id-uniqueness.ts` (new): the collision finders and the shared wording.
- `packages/cli/src/rules/inspect.ts`: `verifyOneRule` applies the check around the engine layers; the `sg` branch of `testOneRule` reaches it through the same helper rather than a second `verifySgRule` call.
- `packages/cli/src/rules/files.ts`: `writeRuleFile` warns after the write.
- `packages/cli/src/filesystem/migrations/0009-unique-rule-ids.ts` (new), registered in `migrate.ts`; `LATEST_SCHEMA_VERSION` becomes 9 and `.taskless/taskless.json` is migrated and committed.
- Tests: `packages/cli/test/rule-id-uniqueness.test.ts`.
- `.changeset/rule-id-uniqueness.md`.
