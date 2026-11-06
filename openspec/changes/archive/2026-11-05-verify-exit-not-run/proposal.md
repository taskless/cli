## Why

`verify` on a runtime rule without `--dangerously-run-scripts` skips every fixture and exits 0, with a top-level `ok: true` over a rule reporting `ran: false`. Automation usually reads only the exit code, so a rule nothing exercised looks the same as one that passed. `verify` is how an agent proves a rule before relying on it, so this is a false pass (#612).

The spec requires this behavior today, on the grounds that no action could turn the failure green. That is not true of `verify`: the flag runs the fixtures.

## What Changes

- `verify` exits 2 when no rule failed and at least one requested rule did not run, including when other rules in the run passed.
- A failed rule still exits 1, and outranks a rule that did not run.
- Top-level `ok` under `--json` is `false` whenever the exit code is non-zero.
- The pre-commit recipe names `.taskless/rules/sg` and `.taskless/rules/vale` instead of running a bare `verify`, because a hook never passes the flag and any non-zero exit blocks the commit.
- A script or hook running bare `verify` in a project with runtime rules now sees exit 2 unless it passes the flag or scopes to the static engines.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-rule-validation`: `verify` no longer treats a rule that did not run as success.

## Impact

- `packages/cli/src/commands/verify.ts`, `src/schemas/rule-check.ts`, and the `validate-rule` and `hooks` recipes.
- `validate` is unaffected: it never runs fixtures, so it never refuses.
- Delivery shape: **single PR**. The exit code, the recipes that depend on it and the spec change only make sense together, and the diff fits one review.
