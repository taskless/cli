## MODIFIED Requirements

### Requirement: Rules delete removes rule and test files

`taskless rule delete <id>` SHALL remove the rule and everything that defines it. Under the rule-directory layout that is one directory, `.taskless/rules/<engine>/<id>/`, which carries the rule, any per-engine config, and its tests. (Renamed; repathed.) Accepts `--anonymous` as a no-op.

A rule id does not carry its engine, so the CLI SHALL **resolve** which engine directory holds `<id>` rather than assuming one. A rule id is globally unique by construction, so at most one engine can hold it. When no engine holds the id, the CLI SHALL report not-found without naming an engine, because naming one would be a guess.

#### Scenario: Deleting a rule removes its whole directory

- **WHEN** a user runs `taskless rule delete no-eval`
- **THEN** the CLI SHALL remove the rule's directory including its `.tests/`
- **AND** no file belonging to that rule SHALL remain

#### Scenario: Deleting a rule filed under any engine

- **WHEN** a rule with id `<id>` exists under `.taskless/rules/vale/<id>/` or `.taskless/rules/runtime/<id>/`
- **THEN** `taskless rule delete <id>` SHALL remove that directory
- **AND** SHALL NOT report not-found for a rule that is present on disk

#### Scenario: Deleting an id no engine holds

- **WHEN** no engine directory contains `<id>`
- **THEN** the CLI SHALL report the rule was not found under `.taskless/rules/`
- **AND** the message SHALL NOT name a single engine's path
