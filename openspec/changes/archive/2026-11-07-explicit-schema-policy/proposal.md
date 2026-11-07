## Why

The `.taskless/` scaffold is always absent, behind, current, or ahead of the running CLI, but nothing named those states. Each command picked one of two helpers, `requireCurrentSchema` (refuse) or `ensureTasklessDirectory` (migrate), and which policy a command got depended on which helper it happened to call. That is how `onboard` and `report` kept migrating after only `init` was meant to (#621), and the "scaffold newer than this CLI" refusal was implemented twice with identical text (#626).

The same accident still applied to `rule create`, `rule improve`, `rule restore` and `rule rollback`: they reach the rule write path, which migrates a behind scaffold before writing, so they moved and deleted tracked files as a side effect, after the service call.

## What Changes

- One read-only classifier, `classifySchema(cwd)`, returning `absent`, `behind`, `current` or `ahead`. It keys on the directory, so a `.taskless/` with no manifest is `behind`.
- One policy per command, `migrate`, `scaffold-if-absent` or `refuse`, applied by a single `ensureSchema(cwd, policy, options)`. The ahead and behind refusal messages are each built in one place.
- Every command and the wizard call `ensureSchema`. `requireCurrentSchema` and `pendingMigration` are removed. `ensureTasklessDirectory` and `runMigrations` remain as the mechanism the `migrate` policy uses.
- **Behavior change:** `rule create`, `rule improve`, `rule restore` and `rule rollback` refuse a behind scaffold with `SCAFFOLD_MIGRATION_REQUIRED`, and an ahead one with `SCAFFOLD_VERSION_MISMATCH`, before resolving identity or calling the service. An absent scaffold is still created when the rule is written. Every other command behaves as before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-rules`: the rule-writing commands refuse a scaffold that is not current.
- `cli-taskless-bootstrap`: the scaffold states and per-command policies are specified.

## Impact

- `packages/cli/src/filesystem/migrate.ts`, `filesystem/directory.ts`, and every command call site in `commands/` and `wizard/`.
- `packages/cli/src/rules/files.ts` is deliberately untouched: the rule commands enforce the policy at the command level, so this change does not conflict with the `writeServedRule` split in #632.
- Delivery shape: **stacked** on #630 (#621), whose `onboard`/`report` refusal it generalizes. The layer is green on its own.
