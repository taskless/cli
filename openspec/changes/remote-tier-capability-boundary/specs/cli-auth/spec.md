## ADDED Requirements

### Requirement: Remote resolution reports which population a failure belongs to

Repository URL resolution SHALL distinguish three failure populations: the directory is not a git repository; the repository has no `origin` remote; the `origin` remote is not a GitHub URL. Each SHALL carry its own stable error code. The pre-existing `NO_GITHUB_REMOTE` code SHALL remain valid so consumers that branch on it keep working.

#### Scenario: Populations are distinguishable

- **WHEN** resolution fails in each of the three populations
- **THEN** each SHALL produce a distinct code
- **AND** a consumer SHALL determine the population from the code without parsing the message

#### Scenario: The existing code is retained

- **WHEN** this change ships
- **THEN** `NO_GITHUB_REMOTE` SHALL remain a member of the error-code contract

#### Scenario: Plain-text auth status is unchanged

- **WHEN** a user runs `taskless auth`
- **THEN** the output SHALL be the existing plain-text status
- **AND** no structured payload SHALL be added to this command
