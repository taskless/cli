## 1. The check

- [x] 1.1 Add `rules/id-uniqueness.ts`: `findRuleIdCollision` for one id (over `findRuleEngines`), `findRuleIdCollisions` for the tree (one pass over the per-engine id lists), `metadataSidecarPath`, and `describeRuleIdCollision` carrying `rules delete`'s opening clause verbatim.
- [x] 1.2 `rules/inspect.ts`: split `verifyOneRule` into the engine layers plus a uniqueness wrapper; list the collision first among the errors; attribute no constraint. Reach it from the `sg` branch of `testOneRule` without a second `verifySgRule` call.
- [x] 1.3 `rules/files.ts`: `writeRuleFile` warns after the write when another engine holds the id, and still returns the path.

## 2. The migration

- [x] 2.1 Verify the rename is safe: confirm the metadata sidecar is never written by this CLI, and enumerate every reference to a rule id per engine, proving each lives inside the rule's own directory.
- [x] 2.2 Add `filesystem/migrations/0009-unique-rule-ids.ts`: rename every colliding copy to `<id>-<engine>`, carrying the rule file, its `id:`, sg fixtures and their `id:`, and the Vale breadcrumb and both `<id>.<id>` segments. Next free `-N` suffix when the target is taken, sidecar left in place, every rename printed. Register `"9"` in `migrate.ts`.
- [x] 2.3 Break the cycle at its cause: extract the manifest from `migrate.ts` into `filesystem/manifest.ts`, which imports nothing from the runner, and repoint all six manifest importers directly. `0009` then reaches `rules/reconcile-marker` for `pathExists` with no loop.
- [x] 2.4 Prove it end to end on a real v8 scaffold: `check` → `init` → `verify` → `check`, including that both renamed rules still fire under their new ids.
- [x] 2.5 Migrate this repository's own `.taskless/` with `pnpm build && pnpm cli init` and commit the rewritten manifest.

## 3. Tests

- [x] 3.1 `test/rule-id-uniqueness.test.ts`: a colliding pair fails `verify` from either side naming both paths; a single rule verified alone catches the collision; a non-colliding tree passes and reports no collisions; the collision carries no `violations`.
- [x] 3.2 The migration renames symmetrically; an sg rule's file, `id:` and fixtures follow; a Vale rule's style file and both config segments follow; a runtime rule moves by directory alone; a taken target takes the next free suffix without touching the existing rule; the sidecar is left in place; no collision is left behind; two runs write nothing on a clean project and nothing after a rename; a missing rules tree is a no-op. Plus unit cases for `retargetValeConfig`.
- [x] 3.3 `writeRuleFile` still writes through a collision and warns, and does not warn without one.

## 4. Release

- [x] 4.1 `.changeset/rule-id-uniqueness.md`, `patch`, saying what a user holding an existing collision must do.
- [x] 4.2 `test/migration-registry.test.ts`: every registered version applies when the graph is entered at a migration module. Validated by reintroducing the cycle and confirming the test fails — two earlier forms of it passed against the same broken tree.
- [x] 4.3 `pnpm typecheck`, `pnpm lint`, `pnpm --filter @taskless/cli test`.
