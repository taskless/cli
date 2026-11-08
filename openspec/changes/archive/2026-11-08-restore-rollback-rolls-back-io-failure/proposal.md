## Why

`multi-rule-delivery-rolls-back-io-failure` made `rule create` and `rule improve` stage every rule and move it into place with `rename`, rolling back on an IO failure. `rule restore` and `rule rollback` were left on the in-place write, so an IO failure part-way through (a full disk, `EACCES` on one file) could leave `.taskless/rules/<engine>/<id>/` holding the new rule file beside the old fixtures, while the command failed with `INTERNAL_ERROR` (#636).

## What Changes

- `rule restore` and `rule rollback` write their one rule through the same staged delivery as `rule create`: staged in full under `.taskless/`, then renamed over the rule directory, with any version already there renamed aside first and back again on failure.
- A write that fails leaves `.taskless/rules/` as it was and no staging directory behind, and exits with a new code, `RULE_RESTORE_FAILED`, rather than `INTERNAL_ERROR`.
- A verified served set that is still not a writable rule (an unsafe fixture path, an incomplete set) exits with `RULE_RESTORE_MISMATCH` rather than `INTERNAL_ERROR`, and writes nothing.
- The rule directory is replaced whole, so the "rule written, but a stale entry beside it could not be removed" success with a notice no longer exists. Every entry of the old directory goes with it, including ones the in-place purge declined to touch.
- The in-place `writeServedRule` and `writePreparedRule` are removed; no command writes a rule in place any more.
- What is not atomic is stated, as for `rule create`: a process killed outright between the two renames leaves the replaced version under `.taskless/.tmp-delivery-*`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-generated-rule-delivery`: a delivered rule replaces its directory whole; the stale-entry notice is gone.
- `cli-rule-recovery`: restore and rollback roll back a failed write, and report it as `RULE_RESTORE_FAILED`.

## Impact

- `packages/cli/src/rules/recover.ts` (`write`), `packages/cli/src/rules/files.ts` (removes `writeServedRule` and `writePreparedRule`), `packages/cli/src/types/errors.ts` (`RULE_RESTORE_FAILED`), and the `recover-rule` recipe's error table.
- Delivery shape: **single PR**. The change is one write path and its tests.
