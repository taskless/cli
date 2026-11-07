## ADDED Requirements

### Requirement: Rule-writing commands refuse a scaffold that is not current

`taskless rule create`, `taskless rule improve`, `taskless rule restore` and `taskless rule rollback` SHALL NOT migrate `.taskless/`. Before resolving identity or calling the service, each SHALL refuse a scaffold whose schema version is below the latest migration with `SCAFFOLD_MIGRATION_REQUIRED`, naming `taskless init`, and one whose version is above it with `SCAFFOLD_VERSION_MISMATCH`, unless `--allow-version-mismatches` (or `TASKLESS_ALLOW_VERSION_MISMATCHES`) is set. The refusal SHALL exit non-zero and be reported as the command reports any other error: on stderr, or as the `{ ok: false, code, message }` envelope under `--json`. A `.taskless/` that is absent SHALL still be created when the first rule is written, as before. `rule create --resume` and `rule improve --resume` SHALL refuse the same way.

#### Scenario: Rule create refuses a scaffold that is behind the CLI

- **WHEN** `.taskless/taskless.json` records a schema version below the latest migration and a user runs `taskless rule create --from <path> --json`
- **THEN** stdout SHALL be the envelope `{ ok: false, code: "SCAFFOLD_MIGRATION_REQUIRED", message }`, and the message SHALL name `taskless init`
- **AND** the command SHALL NOT call the service
- **AND** SHALL leave every file under `.taskless/` as it was

#### Scenario: Rule improve, restore and rollback refuse the same way

- **WHEN** `.taskless/` is behind the CLI and a user runs `taskless rule improve`, `taskless rule restore <id>`, or `taskless rule rollback <id> <revision>`
- **THEN** the command SHALL exit non-zero with `SCAFFOLD_MIGRATION_REQUIRED`
- **AND** SHALL leave every file under `.taskless/` as it was

#### Scenario: Rule-writing commands refuse a scaffold newer than the CLI

- **WHEN** `.taskless/taskless.json` records a schema version above the latest migration and none of the version-mismatch overrides is set
- **THEN** each of these commands SHALL exit non-zero with `SCAFFOLD_VERSION_MISMATCH`, saying to upgrade the CLI

#### Scenario: An absent scaffold is still created by the write

- **WHEN** a project has no `.taskless/` directory and `taskless rule create` delivers a rule
- **THEN** the command SHALL create `.taskless/` at the latest schema version and write the rule into it
