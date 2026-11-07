## MODIFIED Requirements

### Requirement: Report subcommand exists with a draft mode, a publish mode, and delete

The CLI SHALL provide a `taskless report` subcommand accepting the standard `--dir`/`-d` working-directory flag. Invoked with no mode flag it SHALL print a draft. Invoked with `--from <path>` it SHALL publish. `taskless report --delete <record>` SHALL delete a previously published report. `--from` and `--delete` SHALL be mutually exclusive; supplying both SHALL exit non-zero with `INVALID_INPUT`. The subcommand SHALL require no authentication in any mode, and SHALL bootstrap `.taskless/` before reading or writing under it.

The subcommand SHALL NOT migrate `.taskless/`. In every mode, before bootstrapping, it SHALL refuse a scaffold whose schema version is below the latest migration with `SCAFFOLD_MIGRATION_REQUIRED`, and one whose version is above it with `SCAFFOLD_VERSION_MISMATCH`, exiting non-zero and reporting the code as it reports any other error: on stderr, or as the `{ ok: false, code, message }` envelope under `--json`. Migrations move and delete tracked files, and `taskless init` is the command that runs them. A `.taskless/` that is absent SHALL still be created, since creating a fresh directory rewrites nothing.

#### Scenario: Report is registered

- **WHEN** a user runs `taskless --help`
- **THEN** `report` SHALL appear in the list of subcommands

#### Scenario: Report works logged out

- **WHEN** a user who has never logged in runs `taskless report` or `taskless report --from <path>`
- **THEN** the command SHALL NOT prompt for or require authentication

#### Scenario: Report refuses a scaffold that is behind the CLI

- **WHEN** `.taskless/taskless.json` records a schema version below the latest migration and a user runs `taskless report`, `taskless report --from <path>`, or `taskless report --delete <record>`
- **THEN** the command SHALL exit non-zero with `SCAFFOLD_MIGRATION_REQUIRED`, naming `taskless init`
- **AND** SHALL NOT print a draft, publish, or delete anything
- **AND** SHALL leave every file under `.taskless/` as it was

#### Scenario: Report --json carries the refusal code

- **WHEN** `.taskless/` is behind the CLI and a user runs `taskless report --json`
- **THEN** stdout SHALL be exactly the envelope `{ ok: false, code: "SCAFFOLD_MIGRATION_REQUIRED", message }`
