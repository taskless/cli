## Why

`multi-rule-delivery-checks-every-rule` made a request's rules all or nothing against every check that runs before a write, and named what it left out: an IO failure part-way through the writes themselves (a full disk, `EACCES` on the second rule) still left the earlier rules written while the command failed and reported no rules (#623). Under `--json` that failure also surfaced as `INTERNAL_ERROR`.

## What Changes

- `rule create` and `rule improve` stage every rule of a request in full in a temporary directory under `.taskless/`, then move each into `.taskless/rules/` with `rename`, moving any version already there aside first.
- An IO failure while staging or moving rolls back the rules already moved: each new directory is removed, each replaced version is renamed back, and directories the move created are removed. `.taskless/rules/` is left as it was, the staging directory is removed, and the command fails with `RULE_GENERATION_FAILED`.
- If the rollback itself cannot finish, the staging directory is kept and the error names where each replaced version is.
- What is not atomic is stated, not hidden: each rename is atomic on one filesystem, but a sequence of them is not, so a process killed outright between two renames can leave a mix of new and old rules, with the replaced versions kept under `.taskless/.tmp-delivery-*`.
- `rule restore` and `rule rollback` deliver one rule and behave as before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-generated-rule-delivery`: the multi-rule guarantee now covers an IO failure during the writes, with the residual crash window named.

## Impact

- `packages/cli/src/rules/files.ts` (new `writePreparedRules`), `packages/cli/src/rules/generate.ts` (`deliverRevisions`), and `packages/cli/src/rules/deliver.ts` (exports `assertRuleDirectoryIsNotALink`).
- Delivery shape: **single PR, stacked on #632** (`multi-rule-delivery-checks-every-rule`). It extends that change's requirement and changeset, and lands after it.
