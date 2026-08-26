## ADDED Requirements

### Requirement: Route omits remote generation when no GitHub owner is identifiable

`route` SHALL NOT offer remote rule generation as a destination when no GitHub owner can be identified for the project. It SHALL state why the path is unavailable, so a reader can tell an unavailable capability from an overlooked option.

#### Scenario: No GitHub owner

- **WHEN** an agent runs `route` in any of the three no-remote populations
- **THEN** remote generation SHALL NOT appear among the offered destinations
- **AND** the reason SHALL be stated

#### Scenario: A GitHub owner is present

- **WHEN** an agent runs `route` in a repository with a GitHub `origin`
- **THEN** remote generation SHALL remain available as a destination

#### Scenario: The availability test has one source

- **WHEN** `route` determines whether remote generation is available
- **THEN** it SHALL rely on the repository URL reported by `auth` rather than re-deriving the remote independently
