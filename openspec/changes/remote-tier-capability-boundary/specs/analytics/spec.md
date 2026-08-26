## ADDED Requirements

### Requirement: Identify carries the GitHub owner

Telemetry SHALL include a `gh_owner` property on every identify and on captured events, on authenticated and anonymous runs alike.

When a GitHub owner can be extracted from the project's git remote, `gh_owner` SHALL be that owner segment verbatim. When it cannot, for ANY reason, `gh_owner` SHALL be the literal sentinel `[unknown]` rather than being omitted, so runs with an unresolvable owner are a countable cohort instead of disappearing from aggregates. The sentinel cannot collide with a real value: GitHub owner names are limited to alphanumeric characters and hyphens, so no owner can be spelled `[unknown]`.

"Any reason" includes the case where **git is not installed or not on `PATH`**. That is not one of the three no-remote populations, and it is not an error: the resolution simply cannot run. It resolves to `[unknown]` like every other unresolvable case, and SHALL NOT fail the command or surface a message.

The property SHALL be named `gh_owner` rather than `gh_org`, because the first path segment of a GitHub URL may be either an organization or a user account and the CLI does not determine which.

An unresolvable owner SHALL NOT affect the command: it is a telemetry value, not a precondition.

#### Scenario: Anonymous run in a GitHub repository

- **WHEN** an unauthenticated user runs any command in a repository whose `origin` is a GitHub URL
- **THEN** telemetry SHALL identify with `gh_owner` set to the owner segment of that remote

#### Scenario: Authenticated run in a GitHub repository

- **WHEN** an authenticated user runs any command in a repository whose `origin` is a GitHub URL
- **THEN** telemetry SHALL identify with `gh_owner` set to the owner segment of that remote

#### Scenario: No GitHub owner is resolvable

- **WHEN** a user runs any command in any of the three no-remote populations
- **THEN** telemetry SHALL identify with `gh_owner` set to `[unknown]`
- **AND** the property SHALL be present rather than omitted
- **AND** the command SHALL run to completion unaffected

#### Scenario: git is not installed

- **WHEN** a user runs any command on a host where `git` is not installed or not on `PATH`
- **THEN** telemetry SHALL identify with `gh_owner` set to `[unknown]`
- **AND** the command SHALL run to completion, with no error surfaced for the failed resolution

#### Scenario: The sentinel is distinguishable from a real owner

- **WHEN** `gh_owner` is read in analytics
- **THEN** the value `[unknown]` SHALL identify a run whose owner could not be parsed
- **AND** it SHALL NOT be producible by any valid GitHub owner name

#### Scenario: Owner type is not asserted

- **WHEN** `gh_owner` is recorded
- **THEN** the CLI SHALL NOT infer or record whether the owner is an organization or a user account
