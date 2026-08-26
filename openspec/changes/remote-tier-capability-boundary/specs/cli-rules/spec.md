## MODIFIED Requirements

### Requirement: Rules create resolves identity from JWT and git remote

`taskless rule create` SHALL resolve user identity from the stored JWT and the git remote per the existing identity resolution requirements. (Renamed to singular.)

When the git remote cannot yield a GitHub repository URL, the command SHALL fail with a code naming which population the project is in, and the failure SHALL be presented as a capability boundary on remote generation rather than as a broken repository or an authentication problem.

#### Scenario: Identity comes from the token and the remote

- **WHEN** an authenticated user runs `taskless rule create`
- **THEN** the CLI SHALL take the organization from the stored JWT
- **AND** it SHALL take the repository from the git remote rather than prompting for either

#### Scenario: The project is not a git repository

- **WHEN** an authenticated user runs `taskless rule create` in a directory that is not a git repository
- **THEN** the CLI SHALL fail with the code for that population
- **AND** the message SHALL state that remote generation is unavailable and name local authoring as the path that works

#### Scenario: The repository has no origin remote

- **WHEN** an authenticated user runs `taskless rule create` in a git repository with no `origin` remote
- **THEN** the CLI SHALL fail with the code for that population, distinct from the not-a-git-repository code

#### Scenario: The origin remote is not GitHub

- **WHEN** an authenticated user runs `taskless rule create` in a repository whose `origin` points at a non-GitHub host
- **THEN** the CLI SHALL fail with the code for that population, distinct from the other two
- **AND** the message SHALL state that only GitHub remotes are supported for remote generation

#### Scenario: A no-remote failure is not an auth failure

- **WHEN** any of the three no-remote populations fails `taskless rule create`
- **THEN** the emitted code SHALL NOT be `AUTH_REQUIRED`
- **AND** a consumer SHALL be able to distinguish the two without matching on message text

## ADDED Requirements

### Requirement: Local rule generation requires no GitHub remote

Local rule authoring SHALL complete with no GitHub remote present, in all three no-remote populations. No local authoring path SHALL invoke identity resolution.

#### Scenario: Anonymous create in a non-git directory

- **WHEN** a user runs `taskless rule create --anonymous` in a directory that is not a git repository
- **THEN** the CLI SHALL complete without resolving identity and without a GitHub precondition error

#### Scenario: Anonymous create with a non-GitHub origin

- **WHEN** a user runs `taskless rule create --anonymous` in a repository whose `origin` is not GitHub
- **THEN** the CLI SHALL complete without resolving identity

#### Scenario: Verify and test never require a remote

- **WHEN** a user runs `taskless verify` or `taskless test` in any of the three no-remote populations
- **THEN** the command SHALL run to completion without a GitHub precondition error
