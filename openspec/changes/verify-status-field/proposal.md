## Why

A rule's `verify` result has four outcomes (passed, failed after its tests ran, failed before they ran, refused by the execution policy) spread across three fields: `ok`, `ran` and `refused`. Every consumer combines them with its own precedence, and a consumer that reads `ok` alone can report a rule that never ran as passing. The encoding also admits combinations no producer should emit, such as `ok: true` with `ran: false` (#627).

## What Changes

- Each `verify --json` rule result carries `status`, one of `passed`, `failed`, `not-run` or `refused`, computed once by the producer.
- `ok`, `ran` and `refused` stay, derived from `status` by one constructor, so they can no longer disagree with it. The change is additive for existing `--json` consumers.
- `verify`'s marks, summary counts and exit code, and the report draft's test status, read `status` instead of combining the old fields.
- `validate` runs no tests and does not report `status`.
- The `validate-rule`, `create-sg-rule` and `create-vale-rule` recipes name `status` as the field to branch on.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-rule-validation`: `verify` reports one outcome field per rule.

## Impact

- `packages/cli/src/rules/inspect.ts`, `src/schemas/rule-check.ts`, `src/commands/verify.ts`, `src/report/draft.ts`, and three recipes.
- Exit codes, top-level `ok` and every existing field are unchanged.
- Delivery shape: **single PR**. The field, its consumers and the spec only make sense together, and the diff fits one review.
