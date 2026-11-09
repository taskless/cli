## Why

#655 made `taskless check` fail when the rule service rejects the token, because a rejected token is a fact about the run rather than an outage, and a green CI job is the only signal a team watches. A CLI the service has retired (`cli_upgrade_required`) is the same kind of answer: no rule is verified, no retry can change it, and today `check` still exits 0 with only a notice, run after run.

## What Changes

- A reconcile the rule service answers with `cli_upgrade_required` fails `check`. The run still degrades as before (static rules unverified, runtime rules skipped, one not-verified notice naming the upgrade command), and `failures` adds one line saying the CLI version is no longer supported.
- A rule service that cannot be reached, and every other reconcile that cannot complete, stays non-fatal.
- The `ci` recipe says a retired CLI version fails CI.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-check`: the exit-code requirement and the degrade requirement add a retired CLI version beside a rejected token.

## Impact

- `packages/cli/src/rules/plan-check.ts` (the `upgrade_required` reconcile outcome) and the `ci` recipe.
- Delivery shape: **single PR**. One policy line, its test, and the recipe note.
