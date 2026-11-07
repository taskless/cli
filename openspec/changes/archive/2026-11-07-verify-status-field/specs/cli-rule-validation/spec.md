## ADDED Requirements

### Requirement: Verify reports one outcome per rule

Under `--json`, each rule result from `verify` SHALL carry a `status` naming its outcome, one of `passed`, `failed`, `not-run` or `refused`:

- `passed`: the rule's tests ran and passed.
- `failed`: the rule's tests ran and something failed.
- `not-run`: the rule failed before its tests ran, because `validate` rejected it or its fixtures could not be read, and the execution policy did not refuse it.
- `refused`: the execution policy declined to run the rule's tests.

`ok`, `ran` and `refused` SHALL remain on the result and SHALL be derived from `status`: `ok` is true exactly when `status` is `passed`, `ran` is true exactly when `status` is `passed` or `failed`, and `refused` is present exactly when `status` is `refused`. The CLI's own readers of a verification (the human marks, the summary counts, the exit code and the report draft) SHALL read `status` rather than combining the other three.

`validate` runs no tests and SHALL NOT report `status`.

**Rationale.** Three fields for four outcomes let every consumer invent its own precedence, and let a consumer that reads `ok` alone report a rule that never ran as passing. One field computed by the producer removes the choice. Deriving the old fields from it, rather than setting them alongside it, keeps them consistent for the consumers that already read them.

#### Scenario: A passing rule reports passed

- **WHEN** `verify --json` runs a rule whose tests run and pass
- **THEN** the rule's `status` SHALL be `passed`
- **AND** its `ok` SHALL be `true` and its `ran` SHALL be `true`

#### Scenario: A failing rule reports failed

- **WHEN** `verify --json` runs a rule whose tests run and a case fails
- **THEN** the rule's `status` SHALL be `failed`
- **AND** its `ok` SHALL be `false` and its `ran` SHALL be `true`

#### Scenario: A rule validate rejected reports not-run

- **WHEN** `verify --json` runs a rule that `validate` rejects
- **THEN** the rule's `status` SHALL be `not-run`
- **AND** its `ok` SHALL be `false`, its `ran` SHALL be `false`, and it SHALL carry no `refused`
- **AND** `verify` SHALL exit 1

#### Scenario: A refused rule reports refused

- **WHEN** `verify --json` runs a runtime rule without `--dangerously-run-scripts`
- **THEN** the rule's `status` SHALL be `refused`
- **AND** its `ok` SHALL be `false`, its `ran` SHALL be `false`, and `refused` SHALL carry the reason

#### Scenario: Validate reports no status

- **WHEN** `validate --json` reports a rule
- **THEN** the rule's result SHALL NOT carry `status`
