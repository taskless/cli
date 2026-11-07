## ADDED Requirements

### Requirement: Every command names its schema policy

The CLI SHALL classify a project's `.taskless/` as exactly one of `absent` (no `.taskless/` directory), `behind` (schema version below the latest migration), `current`, or `ahead` (schema version above the latest migration) through a single read-only classifier in `filesystem/migrate.ts`. Classification SHALL key on the directory, not the manifest: a `.taskless/` with no `taskless.json` SHALL classify as `behind` from version 0.

A command under `packages/cli/src/commands/` or `packages/cli/src/wizard/` that touches the scaffold SHALL do so through one function, `ensureSchema(cwd, policy, options)` in `filesystem/directory.ts`, naming one policy:

- `migrate`: create an absent scaffold and migrate a behind one. Used by `init` (interactive and non-interactive) only.
- `scaffold-if-absent`: create an absent scaffold, refuse a behind one with `SCAFFOLD_MIGRATION_REQUIRED`. Used by `validate`, `verify`, `onboard` and `report`.
- `refuse`: change nothing; an absent scaffold is left absent, a behind one is refused with `SCAFFOLD_MIGRATION_REQUIRED`. Used by `check`, `update --rules`, and the rule-writing commands.

Under every policy an `ahead` scaffold SHALL be refused with `SCAFFOLD_VERSION_MISMATCH` unless the version-mismatch override is set, in which case the command SHALL proceed without migrating. The text of that refusal SHALL be built in exactly one place.

#### Scenario: A behind scaffold is migrated only under migrate

- **WHEN** `.taskless/` is behind and `ensureSchema` runs under `migrate`
- **THEN** the pending migrations SHALL run and the result SHALL carry the migration report
- **WHEN** the same scaffold meets `scaffold-if-absent` or `refuse`
- **THEN** `ensureSchema` SHALL throw `SCAFFOLD_MIGRATION_REQUIRED` and leave the scaffold unchanged

#### Scenario: A directory with no manifest is behind

- **WHEN** `.taskless/` exists with no `taskless.json`
- **THEN** the classifier SHALL report `behind` from version 0

#### Scenario: An absent scaffold is created except under refuse

- **WHEN** a project has no `.taskless/` and `ensureSchema` runs under `migrate` or `scaffold-if-absent`
- **THEN** `.taskless/` SHALL be created at the latest schema version
- **WHEN** it runs under `refuse`
- **THEN** no `.taskless/` SHALL be created

#### Scenario: An ahead scaffold is refused under every policy

- **WHEN** `.taskless/` is ahead of the CLI and no override is set
- **THEN** `ensureSchema` SHALL throw `SCAFFOLD_VERSION_MISMATCH` under every policy
- **WHEN** the override is set
- **THEN** `ensureSchema` SHALL return the `ahead` state without changing the scaffold
