## ADDED Requirements

### Requirement: Migration 8 drops BasedOnStyles from Vale rule configs

Migration `8` SHALL delete every `BasedOnStyles` assignment line from each `.taskless/rules/vale/<id>/.vale.ini`, whatever the value, and SHALL change nothing else in the file: every other line, comment, blank line and line ending SHALL be preserved byte for byte, and a comment that mentions `BasedOnStyles` SHALL be left alone. A config without the line SHALL NOT be rewritten. A project with no `rules/vale/` tree SHALL be left as it is. It SHALL NOT modify any shipped migration.

The migration exists because the `create-vale-rule` recipe wrote `BasedOnStyles =` into every matcher through the release before this one, the config schema now rejects the key, and `check` and `verify` refuse to run on a scaffold behind the current version. Without the rewrite every upgraded project's first `check` would refuse the Vale engine over a line the CLI itself wrote.

#### Scenario: An existing scaffold loses the line from every matcher

- **WHEN** `taskless.json` records version 7, a rule's `.vale.ini` carries `BasedOnStyles =` in three matchers, and the CLI bootstraps `.taskless/`
- **THEN** migration 8 SHALL run
- **AND** the config SHALL contain no `BasedOnStyles` line and every other byte unchanged
- **AND** the rewritten config SHALL pass the config schema
- **AND** `taskless.json` SHALL record the latest schema version

#### Scenario: A config without the line is untouched

- **WHEN** a rule's `.vale.ini` carries no `BasedOnStyles` line and migration 8 runs
- **THEN** the file SHALL NOT be written

#### Scenario: A comment naming the key survives

- **WHEN** a rule's `.vale.ini` carries a comment line that mentions `BasedOnStyles` and migration 8 runs
- **THEN** the comment SHALL remain and only assignment lines SHALL be removed

#### Scenario: Migration 8 is idempotent

- **WHEN** migration 8 runs twice over the same scaffold
- **THEN** the second run SHALL change nothing
