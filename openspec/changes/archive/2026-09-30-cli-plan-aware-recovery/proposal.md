## Why

The CLI suggests `taskless rule restore` and `taskless rule rollback` to every user, and learns
that the organization's plan does not include them only when the service refuses the call. A
user on such a plan is told to run a command, runs it, and is then told to use git instead.
v2 `whoami` now returns each organization's `entitlements`, including `restoreRules`
(taskless/taskless#254, live, and already in the vendored `api-v2.schema.json`), so the CLI
can stop suggesting what the plan will not serve. The two changes this builds on, `rule
revisions` (#422) and the `copyOf` rename notice (#423), have both merged.

## What Changes

- The acting organization's `entitlements.restoreRules` is read from the `whoami` call the
  CLI already makes to resolve the organization. No new request. It is tri-state: `true`,
  `false`, or unknown (whoami failed, `entitlements` absent, or no organization matched the
  repository and the CLI fell back to the token's claim).
- When, and only when, `restoreRules` is exactly `false`:
  - `check`'s notice for an `unsafe` or `missing` rule gives the git recovery steps for the
    rule's directory instead of naming `rule restore <ruleId>`.
  - The rename notice (a copy of an issued rule whose source is `missing`) gives the git
    steps for the source's directory instead of naming `rule restore <source>`.
  - `rule revisions` still lists revisions, since the listing is served on every plan. Its
    closing line says rolling back is not included in the plan, instead of naming the
    `rule rollback` command.
- Unknown behaves exactly as today: every suggestion above names `rule restore` /
  `rule rollback`.
- **Suggestions only, never a gate.** `rule restore` and `rule rollback` keep calling the
  service whatever `whoami` said, and keep relaying its refusal verbatim. The schema calls
  `entitlements` "a hint for the client, never a gate", and the refusal is the better answer
  anyway: it carries the exact commands and the upgrade link.
- The `recover-rule` and `check` agent recipes tell an agent to read which recovery `check`
  offered before reaching for `rule restore` or `rule rollback`. Both topics bump their
  version.
- No `--json` change. `integrity` in `check --json` already says what is wrong with each
  rule, and a recovery command an agent runs anyway is answered by the refusal. Nothing found
  in this proposal needs a machine-readable plan field.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `cli-rule-recovery`: adds a requirement that recovery suggestions follow the plan's
  `restoreRules` entitlement, and modifies `rule revisions`' closing line.
- `cli-check`: the "never writes to the rules tree" requirement names the recovery step for
  the plan rather than always `rule restore`.
- `cli-rule-reconciliation`: the verdict table and the rename requirement name the recovery
  step for the plan rather than always `rule restore`. The issue expected only the first two
  specs, but these two requirements state the `rule restore` wording normatively, so leaving
  them would contradict the new requirement.

## Impact

- `packages/cli/src/auth/org.ts`, `auth/identity.ts`: resolve the acting organization's
  `restoreRules` alongside its subject, carried as an optional field on `Identity`.
- `packages/cli/src/rules/verdicts.ts`, `rules/plan-check.ts`: the notice text is rendered
  through one recovery callback that knows the plan, replacing `restoreCommand`.
- `packages/cli/src/rules/recover.ts`, `commands/rules.ts`: `describeRevisions`' closing line.
- `packages/cli/src/agent/recover-rule.md`, `agent/check.md`: topic version bumps.
- Tests: `org.test.ts`, `verdicts.test.ts`, `rule-recovery.test.ts`, and the recipe parity
  tests.
- No schema, dependency, or `--json` change.

**Delivery shape: stacked, merging forward.** Three PRs, each safe in production alone:

1. Resolve `restoreRules` onto `Identity` from the existing whoami call, with this proposal.
   Nothing reads it yet, so output is unchanged.
2. `check`'s suggestions (`unsafe`, `missing`, rename) and the `check` recipe.
3. `rule revisions`' closing line, the `recover-rule` recipe, and the archive.

Unknown preserves today's output exactly, so no intermediate state suggests anything wrong:
a slice that has not landed yet keeps suggesting `rule restore`. The whole diff would fit
one PR; it is split so external reviewers can read each behavior on its own. Unit 1 changes
nothing a user can observe, so the changeset starts on unit 2, and unit 3 extends it.
