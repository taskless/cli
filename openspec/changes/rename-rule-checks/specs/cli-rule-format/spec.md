## RENAMED Requirements

- FROM: `### Requirement: A rule's canonical location is what verify and test address`
- TO: `### Requirement: A rule's canonical location is what validate and verify address`

## MODIFIED Requirements

### Requirement: A rule's canonical location is what validate and verify address

Each engine SHALL have one canonical on-disk location per rule — the rule directory — and that location SHALL be what `validate` and `verify` accept as a path. A directory above it SHALL mean every rule beneath.

#### Scenario: One address per rule

- **WHEN** `validate` or `verify` is given `.taskless/rules/<engine>/<id>/`
- **THEN** it operates on exactly that rule
- **AND** the engine is determined from the path without reading the rule
