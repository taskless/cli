## Why

`taskless onboard` and `taskless report` migrated `.taskless/` as a side effect, in every mode. Migration `0005` moves and deletes tracked files, so an agent that fetched the onboarding recipe or drafted a report rewrote the repository of any project whose scaffold was behind the CLI, and the change landed silently in whatever commit came next (#621). `check`, `validate` and `verify` already refuse instead of migrating, and `init` is meant to be the only command that migrates.

## What Changes

- `onboard`, in every mode (recipe, `--force`, `--mark-complete`), refuses a scaffold that is behind the CLI with `SCAFFOLD_MIGRATION_REQUIRED`, and one that is ahead with `SCAFFOLD_VERSION_MISMATCH`, before reading or writing anything. The code is printed on stderr so the recipe can branch on it.
- `report`, in every mode (draft, `--from`, `--delete`), refuses the same way, through its existing error path: prose with the code, or the `{ ok: false, code, message }` envelope under `--json`.
- Both still scaffold a `.taskless/` that is absent, as before. Creating a fresh directory is not a rewrite.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-onboard`: the subcommand refuses a behind or ahead scaffold instead of migrating it.
- `cli-report`: the subcommand refuses a behind or ahead scaffold instead of migrating it.

## Impact

- `packages/cli/src/commands/onboard.ts` and `packages/cli/src/commands/report.ts`.
- A user who upgrades the CLI and runs `onboard` or `report` before `init` now meets a refusal naming `init`, where before the scaffold was migrated silently.
- Delivery shape: **single PR**. Two call sites, their tests, and the spec change fit one review.
