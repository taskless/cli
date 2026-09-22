## Why

Nothing keeps `.taskless/rules/sg/no-eval/` and `.taskless/rules/vale/no-eval/` from both existing. `isValidRuleId` is `/^[a-z0-9][a-z0-9-]*$/`, with no engine component and no cross-engine check; the write path resolves one engine and `mkdir`s inside it; the read path asks `listRuleIds` per engine and never diffs the answers. `findRuleEngines` already returns every engine holding an id, and its docblock already says the uniqueness the old code assumed was never true of the ids this CLI accepts.

The visible cost is that human `check` output cannot tell the two apart: `util/format.ts` prints `severity[ruleId]` with no engine, so a collision shows two identical `error[no-eval]` lines. The JSON envelope is fine — every result carries `source` — so a machine consumer keying on `(source, ruleId)` is correct and one keying on `ruleId` alone silently merges two rules.

The metadata-sidecar clobber that #387 leads with is LATENT rather than live, and that is what makes an automatic rename safe. `writeRuleMetaFiles` keys `.taskless/rule-metadata/{id}.yml` on the id alone, so two colliding rules would share one file — but nothing writes one. The sidecar comes from the `meta` block of a rule status response, the service does not populate it, and both call sites are documented as dead in practice; `rule meta` reports `RULE_META_UNAVAILABLE` saying so, and `.taskless/rule-metadata/` does not exist in this repository. There is no metadata for a rename to destroy.

## What Changes

- **`verify` fails a rule whose id is held by more than one engine**, naming every holding directory and the shared metadata sidecar, and telling the user to rename one. The check is **per rule**, not only project-wide: `verify` runs on a single rule as well as on the tree, and verifying the rule an author just wrote is the moment the collision is cheapest to fix. The project-wide form falls out of running it for each rule. `test` inherits it, because `test` runs `verify` first.
- **The failure is not a `RULE_CONSTRAINTS` entry.** Every constraint is declared for one `engine` and published per engine in the conformance corpus, because a constraint says what this CLI requires of a rule for that engine beyond what the engine itself requires. This requires nothing of the rule: the file is valid, and what is wrong is that a sibling tree holds the same directory name. Giving it an engine would mean inventing an engine-agnostic constraint kind for one entry, or filing three near-identical ones and telling a generator that ast-grep has a house rule about Vale. It is reported in `errors` with no `violations` attribution, the same way every other non-engine finding already is.
- **The wording matches `rules delete`.** `rules delete` refuses the same state with `RULE_ID_AMBIGUOUS` and "Rule … is held by N engines, so there is no single rule to delete: <paths>". The opening clause is shared verbatim and only the consequence differs, so the two surfaces cannot come to describe one condition as two.
- **`writeRuleFile` warns and still writes.** `check`'s repair path calls it, so a refusal would brick repair for both colliding rules — strictly worse than the silence it would replace. The failure belongs in `verify`, which is what the warning points at.
- **Migration `9` renames the colliding `sg` and `vale` copies to `<id>-<engine>`** on upgrade. Where both move, neither keeps the bare id, because any precedence rule between them would be arbitrary and would leave a user working out which of their two rules kept the name.
- **A `runtime` copy is never renamed** and keeps the bare id. Runtime rules are the signed and blessed tier, and leaving them untouched keeps the migration clear of that machinery rather than reasoning about it. It costs nothing: within one engine the filesystem already guarantees one directory per id, so moving the other copies resolves the collision either way. Measured, a rename would in fact have been safe — `signRuleFile` hashes the CONTENT of `check.ts` and never its path — so this is a precaution, not a correctness fix. `LATEST_SCHEMA_VERSION` becomes 9 and this repository's own `.taskless/taskless.json` is bumped with it.
- **It renames rather than refuses, because refusing walls `init`.** `check` and `verify` send a stale scaffold to `init` with `SCAFFOLD_MIGRATION_REQUIRED`, and `init` is what runs migrations — so a throwing migration makes the CLI's own instruction the thing that fails, with a multi-file hand edit as the only way out. Renaming resolves it at the one moment the CLI has both the user's attention and full knowledge of the layout.
- **The rename reaches nothing outside the rule's own directory**, which is what makes it safe to do automatically. Measured against this tree: `sg` carries the id in the directory, `<id>.yml`, its `id:` field, and every `.tests/<id>-*-test.yml` plus each fixture's own `id:`; `vale` in the directory, `<id>.yml`, and both the `tskl) rule` breadcrumb and both segments of `<id>.<id>` in `.vale.ini` (both, because `StylesPath` points at `rules/vale`, so the directory is the style and `<id>.yml` the check); `runtime` nowhere, since it is never renamed. Nothing outside names a rule id: `taskless.json` records versions, and the runtime reconcile join is by content signature, so a moved-but-unchanged rule still resolves.
- **It never clobbers, and it reports everything.** A taken `<id>-<engine>` takes the first free `<id>-<engine>-N` from 2, where free means held by no engine, so clearing one collision cannot create another. Every rename is printed — old path, new path, each file rewritten — because a migration that silently renames a user's rules is worse than one that refuses.
- **The metadata sidecar is left in place.** The rename is symmetric, so `rule-metadata/<id>.yml` has no owner to follow and moving it to either side would be a guess. It is left, reported, and orphaned, which costs nothing: the service does not populate the `meta` block a sidecar is written from, so this CLI has never written one and `.taskless/rule-metadata/` does not exist in this repository. `rule meta` says exactly that when asked, and the `status.meta` branch that would write one is documented as dead in practice.

Deliberately out of scope, per taskless/cli#387: whether the metadata sidecar should gain an engine segment, and whether `check --rule <id>` should stop selecting both engines. The filter over-selects rather than mis-selects, its findings carry `source`, and once `verify` refuses the collision the case stops arising.

## Delivery shape

**Single PR.** The `verify` failure and the migration are one behavior seen from two moments, and shipping either alone is wrong in a way the other fixes: the check without the migration only ever fires for rules written after it, while a project that already collides keeps sharing a sidecar; the migration without the check walls off existing projects for a condition nothing else reports. The diff is small enough to review whole, and the spec, implementation and archive land together.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-rule-validation`: a new requirement for the per-rule uniqueness refusal; "Rules are validated and tested by path, not by id" restated so its cross-engine scenario says what addressing still guarantees and what `verify` now reports.
- `cli-taskless-bootstrap`: a new requirement for migration 9, the rename it performs per engine, and what it refuses to touch.

## Impact

- `packages/cli/src/rules/id-uniqueness.ts` (new): the collision finders and the shared wording.
- `packages/cli/src/rules/inspect.ts`: `verifyOneRule` applies the check around the engine layers; the `sg` branch of `testOneRule` reaches it through the same helper rather than a second `verifySgRule` call.
- `packages/cli/src/rules/files.ts`: `writeRuleFile` warns after the write.
- `packages/cli/src/filesystem/migrations/0009-unique-rule-ids.ts` (new), registered in `migrate.ts`; `LATEST_SCHEMA_VERSION` becomes 9 and `.taskless/taskless.json` is migrated and committed.
- `packages/cli/src/filesystem/manifest.ts` (new): the manifest shape and its two accessors, extracted from `migrate.ts` so reading the manifest no longer loads the migration registry. `install/state.ts`, `rules/reconcile-marker.ts`, `commands/info.ts`, `commands/init.ts`, `commands/onboard.ts` and `test/migrate-install.test.ts` import it directly; nothing re-exports from `migrate.ts`. This is what lets `0009` reach `reconcile-marker` for `pathExists` at all: while the two halves shared a module, that import closed a loop through the runner and left `migrations["9"]` undefined.
- Tests: `packages/cli/test/rule-id-uniqueness.test.ts`.
- `.changeset/rule-id-uniqueness.md`.
