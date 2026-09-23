## Why

Migration `9` renames rule directories whose id is held by more than one
engine. Two defects were found while verifying that the nine scaffold
migrations are idempotent (taskless/cli#395). Idempotency holds — repeated
COMPLETE runs converge, measured by tree snapshot across a double run. What
does not hold is atomicity.

**It cannot resume after an interrupted run.** The migration renamed the rule
DIRECTORY first and then chased the files inside it. A collision is defined as
one directory name appearing under two or more engines, so the directory
rename is the operation that CLEARS the collision — and the migration returns
early when there are none. A crash between the directory rename and the rest
therefore leaves `sg/no-eval-sg/` holding `no-eval.yml` with `id: no-eval` and
fixtures still under the `no-eval-` prefix, a tree `verify` reports as broken
and that no number of re-runs repairs, because every later run returns at the
collision gate having found nothing to do.

**The fixture predicate matched its own output.** `entry.startsWith(`${from}-`)`
accepted every name the loop produced, since the replacement is `${from}-sg`.
Re-running could not trigger it — the directory rename throws `ENOENT`first —
but a fixture a human had named`no-eval-sg-basic-test.yml`BEFORE the
migration ran came out as`no-eval-sg-sg-basic-test.yml` on the first run. It
is also the step a resumed run repeats, so it stops being cosmetic the moment
the resume above exists.

**Migration 9 has never shipped, so its behaviour is changed in place.**
`npm view @taskless/cli dist-tags` reports `latest: 0.11.2`, tagged
2026-09-19; the migration landed in `d41576f` on 2026-09-22, and
`git merge-base --is-ancestor d41576f v0.11.2` fails. No user has run it, so
there is no already-migrated tree in the wild and no migration `10` to write.

## What Changes

- **Ordering is the fix.** Every edit inside a rule now happens under the OLD
  directory name, and the directory rename runs LAST as the single atomic
  commit. A rule that crashes before it still holds the colliding id, so the
  collision gate finds it again; a rule that crashes after it is already whole.
  The gate becomes a sound resume signal rather than merely a no-op check.
- Each step inside the directory tolerates having already run: a rule file
  whose source is gone but whose target is present still has its `id:`
  rewritten, and file rewrites are committed by renaming a temporary sibling.
- The fixture predicate skips a name already carrying the target prefix and
  rewrites only its `id:`, so it can no longer match what it produces.
- Tests: a crash injected at three named `rename` destinations, each resumed
  and asserted to reach a consistent directory, fixture name and `id:` field;
  and the pre-existing `-sg-` fixture name. Two of the three crash points and
  the double-suffix case fail against the previous code.

## Capabilities

### New Capabilities

None. `cli-taskless-bootstrap` gains one requirement.

### Modified Capabilities

None. "Migration 9 renames a rule id held by more than one engine" is
unchanged: it already requires every `.tests/<id>-*-test.yml` to end at the new
prefix with its `id:` rewritten, which a fixture already at that prefix
satisfies without being renamed again.

## Impact

`packages/cli/src/filesystem/migrations/0009-unique-rule-ids.ts` and its test.
No public surface, no other command. The bump is `patch`: the migration has
never been in a released version, so no consumer crosses this boundary.

## Delivery shape

**Single PR.** One source file, one test file, one spec requirement — a diff
under 300 hand-written lines that is only reviewable together, since the
ordering change and the tests that prove it are the same argument. It is the
tip, so the change is archived here.
