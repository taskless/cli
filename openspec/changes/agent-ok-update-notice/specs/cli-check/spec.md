## ADDED Requirements

### Requirement: Check warns when Taskless is out of date outside CI

When `taskless check` runs outside a CI environment, it SHALL measure whether the Taskless environment is out of date, with the same cli, skill, and rules parts and the same rules that `taskless agent ok` uses, and SHALL do so alongside the scan rather than before it. When one or more parts are out of date, `check` SHALL publish one notice that names each out-of-date part and the command that fixes it. In text output, the notice SHALL print through the same marked-notice path as every other notice. Under `--json`, it SHALL be an entry in the `notices` array.

The measurement SHALL NOT change the exit code, the results, or which rules run. A latest-version lookup that fails or times out SHALL leave the cli part out, silently. In a CI environment, `check` SHALL NOT measure, SHALL NOT contact the registry, and SHALL publish no such notice. When `NO_UPDATE_NOTIFIER` is set to a non-empty value, `check` SHALL NOT measure, SHALL NOT contact the registry, and SHALL publish no such notice. The notice SHALL be a single line, numbering its steps inline, so that each `--json` `notices` element is one line.

#### Scenario: Out-of-date environment adds a notice locally

- **WHEN** `taskless check` runs outside CI in a project whose environment is out of date
- **THEN** its output SHALL carry one notice naming the out-of-date parts and their fixing commands
- **AND** the exit code SHALL be the one the scan alone would produce

#### Scenario: The notice is in the JSON envelope

- **WHEN** `taskless check --json` runs outside CI in a project whose environment is out of date
- **THEN** the `notices` array SHALL contain the out-of-date notice
- **AND** stdout SHALL remain a single JSON envelope

#### Scenario: The notice is one line

- **WHEN** `taskless check --json` reports several out-of-date parts
- **THEN** the out-of-date notice SHALL be one element containing no line break

#### Scenario: Up-to-date environment adds nothing

- **WHEN** `taskless check` runs outside CI in a project whose environment is up to date
- **THEN** it SHALL publish no out-of-date notice

#### Scenario: CI is not measured

- **WHEN** `taskless check` runs in a CI environment, or with `NO_UPDATE_NOTIFIER` set
- **THEN** it SHALL NOT contact the registry
- **AND** SHALL publish no out-of-date notice

#### Scenario: A failed lookup does not affect the run

- **WHEN** `taskless check` runs outside CI and the latest-version lookup fails or times out
- **THEN** the run SHALL complete with the results and exit code the scan alone would produce
