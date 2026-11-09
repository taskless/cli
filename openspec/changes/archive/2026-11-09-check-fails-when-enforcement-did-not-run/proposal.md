## Why

`taskless check` exited 0 in two cases where enforcement did not run (#655), and a green CI job is the only signal a team watches:

- A rejected token (revoked or mistyped `TASKLESS_TOKEN`) skipped every runtime rule and ran static rules unverified, with only a notice.
- A runtime rule whose signed files were edited was answered `unsafe` and not executed, but only a notice said so. The same verdict on an `sg` or `vale` rule already failed the run.

## What Changes

- An `unsafe` verdict fails `check` for a runtime rule exactly as for a static one: the message moves from `notices` to `failures`, and the exit code is 1.
- A reconcile the rule service answers with `401 unauthorized` fails `check`. The run still degrades as before (static rules unverified, runtime rules skipped, one not-verified notice naming the fix), and `failures` adds one line saying authentication was rejected.
- A rule service that cannot be reached (`unavailable`), and every other reconcile that cannot complete, stays non-fatal, so a Taskless outage does not turn every customer's CI red.
- `taskless report` is unaffected: its measurement scan runs anonymously and never reconciles.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-check`: the exit-code requirement adds an edited runtime rule and a rejected token; the degrade requirement excepts a rejected token.
- `cli-rule-reconciliation`: the verdict policy fails `check` on a runtime `unsafe` verdict. The requirement is replaced under a new title ("Each engine applies the reconcile verdict policy"), because its "An edited runtime rule is withheld, not failed" scenario is the behavior being reversed and a MODIFIED block cannot drop a scenario.

## Impact

- `packages/cli/src/rules/verdicts.ts` (the `unsafe` branch and the policy table), `packages/cli/src/rules/plan-check.ts` (the `unauthorized` reconcile outcome), and the `ci` recipe.
- Delivery shape: **single PR**. The change is two small policy edits and their tests, landing with #650 and #647 in one reviewable diff.
