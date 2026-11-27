## Why

`report-rule-evidence` folded all seven evidence kinds into two summary totals (`times in reviews` and `times in conventions`). A rule credited with `commits` and zero `reviewComments` still rendered as `"N times in reviews"`, showing a review count the repository never had and diverging from the counts in the facts file.

## What Changes

- Replace the two grouped totals in `taskless report`'s publish summary with per-kind counts (`review comment(s)`, `fix-up commit(s)`, `issue(s)`, `agent file(s)`, `convention(s)`, `doc(s)`, `test(s)`), ordered largest first with `reviews`-group kinds before `conventions`-group kinds on a tie.
- Remove the unused `groupTotals` helper from `src/report/evidence.ts` and update comments/recipe text to describe per-kind evidence counts.
- Delivery shape: **single PR** (`patch` changeset, spec delta + archive, implementation, tests).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-report`: update the publish summary requirement and scenarios from the two grouped totals to per-kind wording and ordering, and add a commits-only scenario.

## Impact

- `packages/cli/src/report/evidence.ts`, `packages/cli/src/report/summary.ts`, `packages/cli/src/agent/report.md`, `packages/cli/test/report.test.ts`, and `openspec/specs/cli-report/spec.md`.
- Changeset: `patch` (pre-1.0, terminal summary wording only).
