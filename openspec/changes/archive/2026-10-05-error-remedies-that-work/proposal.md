## Why

Four error messages give a remedy that does not work as written (#452):

- Migration 0005 tells the user to run migration 0004. No command runs one
  migration, and 0004 is already recorded as done, so it never runs again.
- On a plan without rule recovery, `check` says to restore a rule from the
  commit `git log` lists. For a deleted rule that commit is the deletion, so
  `git restore --source=<commit>` puts back nothing.
- `update --rules` on a project with no `.taskless/` says "Run the CLI once".
  `check`, `verify` and `test` refuse a missing scaffold; only `init` makes one.
- `check` answers a rule id held by two engines with "Rename one." Renaming the
  issued rule turns it into a copy, which does not run either, and a rename has
  to reach the id inside the rule as well as its directory.

## What Changes

- Migration 0005 says to move the loose rule files into `.taskless/sg/rules/`
  by hand, then run `init` again, and names no migration number.
- The git recovery steps restore from `<commit>~1`, the commit before the
  change, and give `git restore --source=HEAD` for a change not yet committed.
  `~1` rather than `^`, which zsh's `extendedglob` reads as a glob.
- `update --rules` names `init`.
- The duplicate-id failure says to rename the locally written rule, not the
  issued one, and lists where the id appears for each engine involved.
- The `check` recipe goes to topic v6, with the new git steps in its example.

## Capabilities

### Modified Capabilities

- `cli-rule-recovery`: the git steps restore from the commit before a change,
  and from `HEAD` for an uncommitted one.

## Delivery

Single PR. Four message fixes, their tests, and one spec delta fit one
reviewable diff, and none depends on another.

## Impact

- `packages/cli/src/filesystem/migrations/0005-rule-directories.ts`
- `packages/cli/src/rules/recovery-advice.ts`
- `packages/cli/src/rules/reconcile-marker.ts`
- `packages/cli/src/rules/plan-check.ts`
- `packages/cli/src/agent/check.md`
- `--json` envelopes keep their codes; only message text changes.
