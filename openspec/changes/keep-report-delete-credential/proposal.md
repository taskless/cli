## Why

`taskless report --from` publishes a report and then writes `.taskless/reports/<stamp>.json`, the only place the report's delete credential is kept. The record name has one-second resolution and is written with "fail if it exists", so two publishes in one second make the second write throw after its report is already live. A directory that cannot be written fails the same way. Either failure reached the top-level handler as a raw filesystem error: the report stayed live for its full lifetime, nothing could delete it, and the user was not shown its URL (#622).

## What Changes

- A record name that is already taken moves to `<stamp>_2.json`, `<stamp>_3.json`, and so on. Nothing is overwritten, records still sort by stamp, and `--delete` accepts the suffixed names.
- A record that still cannot be written exits non-zero with a new code, `REPORT_RECORD_FAILED`. The message states that the report is live and gives its URL and delete URL, and the `--json` envelope carries `url`, `deleteUrl` and `expiresAt`. Printing the credential is the lesser harm when the alternative is a page nobody can take down.
- The `report` recipe lists the new code (topic v8).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-report`: the record is collision-proof, and a record that cannot be written keeps the credential.

## Impact

- `packages/cli/src/report/records.ts`, `src/types/errors.ts`, `src/util/cli-error.ts`, the `--json` envelope in `src/commands/report.ts`, and `src/agent/report.md`.
- `CLIErrorEnvelope` gains optional `url`, `deleteUrl` and `expiresAt` fields, present only for `REPORT_RECORD_FAILED`.
- Delivery shape: **single PR**. The fix, its tests and the spec change fit one review.
