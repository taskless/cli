## Why

`init` decides which permission rules to add by comparing against the manifest record instead of the file. When a rule the record lists is taken out of a harness permission file (a hand edit, a revert, a merge), `init` believes it is still there and never writes it back, and the wizard preview shows no edit. The requirement already says each file SHALL hold the installed package's rules afterwards, and that the record decides only whether a file may be deleted; the code contradicted both. Reported in taskless/cli#624.

## What Changes

- Read which Taskless rules a permission file holds from the file, for adding as well as removing. A recorded rule missing from the file is added back and reported.
- A recorded file that was deleted is written again, and recorded as created by Taskless, so it is deleted again once it holds nothing else.
- The record never lists a rule twice when a rule is restored.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-init`: the permission-file requirement states that presence is read from the file, with scenarios for a removed rule and a deleted file.

## Impact

- `packages/cli/src/install/permissions.ts` (`syncPermissions`) and `packages/cli/test/permissions.test.ts`.
- Delivery shape: **single PR**. A one-function fix and its tests fit one review.
