## ADDED Requirements

### Requirement: The engine-selection topic is registered in the help system

The help system SHALL register the engine-selection recipe as an embedded help topic, retrievable via `taskless help <topic>` and listed in the help index, consistent with the existing topic embedding and format requirements.

#### Scenario: Engine-selection topic resolves

- **WHEN** `taskless help` is run for the engine-selection topic
- **THEN** the recipe text SHALL be returned and an unknown-topic error SHALL NOT be raised

#### Scenario: Engine-selection topic appears in the index

- **WHEN** `taskless help` is run with no arguments
- **THEN** the topic index SHALL include the engine-selection topic so an agent can discover it

### Requirement: Routing recipes reference engine selection

The `route` and `static` recipes SHALL reference the engine-selection topic so an agent following the local authoring flow applies the same engine test the service applies, rather than assuming ast-grep.

#### Scenario: Local flow reaches engine selection

- **WHEN** an agent follows `route` to a destination that authors a Taskless rule
- **THEN** the recipe directs it to the engine-selection topic before the rule is authored
