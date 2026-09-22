## 1. The check

- [x] 1.1 Add `rules/id-uniqueness.ts`: `findRuleIdCollision` for one id (over `findRuleEngines`), `findRuleIdCollisions` for the tree (one pass over the per-engine id lists), `metadataSidecarPath`, and `describeRuleIdCollision` carrying `rules delete`'s opening clause verbatim.
- [x] 1.2 `rules/inspect.ts`: split `verifyOneRule` into the engine layers plus a uniqueness wrapper; list the collision first among the errors; attribute no constraint. Reach it from the `sg` branch of `testOneRule` without a second `verifySgRule` call.
- [x] 1.3 `rules/files.ts`: `writeRuleFile` warns after the write when another engine holds the id, and still returns the path.

## 2. The migration

- [x] 2.1 Add `filesystem/migrations/0009-unique-rule-ids.ts`: read-only, throws a `CLIError` coded `RULE_ID_AMBIGUOUS` naming every holding directory, the shared sidecar, and the rename to perform before re-running `init`. Register `"9"` in `migrate.ts`.
- [x] 2.2 Trace the refusal against `SCAFFOLD_MIGRATION_REQUIRED` and confirm the two messages form a path out rather than a loop.
- [x] 2.3 Migrate this repository's own `.taskless/` with `pnpm build && pnpm cli init` and commit the rewritten manifest.

## 3. Tests

- [x] 3.1 `test/rule-id-uniqueness.test.ts`: a colliding pair fails `verify` from either side naming both paths; a single rule verified alone catches the collision; a non-colliding tree passes and reports no collisions; the collision carries no `violations`.
- [x] 3.2 The migration refuses a colliding project naming both directories, says to rename before re-running `init`, is a no-op and writes nothing on a clean project across two runs, and is a no-op with no rules tree.
- [x] 3.3 `writeRuleFile` still writes through a collision and warns, and does not warn without one.

## 4. Release

- [x] 4.1 `.changeset/rule-id-uniqueness.md`, `patch`, saying what a user holding an existing collision must do.
- [x] 4.2 `pnpm typecheck`, `pnpm lint`, `pnpm --filter @taskless/cli test`.
