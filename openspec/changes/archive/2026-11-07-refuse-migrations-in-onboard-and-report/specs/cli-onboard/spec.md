## MODIFIED Requirements

### Requirement: Onboard subcommand exists with --force and --mark-complete flags

The CLI SHALL support a `taskless onboard` subcommand. The subcommand SHALL accept the global `-d` working-directory flag, a `--force` boolean flag (default `false`), and a `--mark-complete` boolean flag (default `false`). `--force` and `--mark-complete` SHALL be mutually exclusive; supplying both SHALL exit with code 1 and a clear error message. The subcommand SHALL bootstrap the `.taskless/` directory via `ensureTasklessDirectory()` before reading or writing manifest state.

The subcommand SHALL NOT migrate `.taskless/`. In every mode, before bootstrapping, it SHALL refuse a scaffold whose schema version is below the latest migration with `SCAFFOLD_MIGRATION_REQUIRED`, and one whose version is above it with `SCAFFOLD_VERSION_MISMATCH`, exiting with code 1, printing the code on stderr, and naming the command that resolves it. Migrations move and delete tracked files, and `taskless init` is the command that runs them. A `.taskless/` that is absent SHALL still be created, since creating a fresh directory rewrites nothing.

#### Scenario: Onboard command is registered

- **WHEN** a user runs `taskless --help`
- **THEN** `onboard` SHALL appear in the list of available subcommands
- **AND** the description SHALL describe it as the post-install discovery flow

#### Scenario: Onboard accepts --force

- **WHEN** a user runs `taskless onboard --force`
- **THEN** the command SHALL accept the flag without error

#### Scenario: Onboard accepts --mark-complete

- **WHEN** a user (or agent) runs `taskless onboard --mark-complete`
- **THEN** the command SHALL accept the flag without error

#### Scenario: --force and --mark-complete are mutually exclusive

- **WHEN** a user runs `taskless onboard --force --mark-complete`
- **THEN** the command SHALL exit with code 1
- **AND** SHALL print an error message stating that the two flags cannot be combined

#### Scenario: Onboard respects the global -d flag

- **WHEN** a user runs `taskless onboard -d /path/to/repo`
- **THEN** all manifest reads and writes SHALL operate on `/path/to/repo/.taskless/taskless.json`

#### Scenario: Onboard refuses a scaffold that is behind the CLI

- **WHEN** `.taskless/taskless.json` records a schema version below the latest migration and a user runs `taskless onboard`, with or without `--force` or `--mark-complete`
- **THEN** the command SHALL exit with code 1 and print `SCAFFOLD_MIGRATION_REQUIRED` on stderr, naming `taskless init`
- **AND** SHALL NOT print the recipe or write the manifest
- **AND** SHALL leave every file under `.taskless/` as it was

#### Scenario: Onboard scaffolds a project with no .taskless directory

- **WHEN** no `.taskless/` exists and a user runs `taskless onboard`
- **THEN** the command SHALL create `.taskless/` at the latest schema version and print the recipe
