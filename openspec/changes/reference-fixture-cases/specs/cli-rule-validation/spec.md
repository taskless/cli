## ADDED Requirements

### Requirement: A rejection names the constraint it violated

`verify --json` and `test --json` SHALL report, per rule, the constraints a
rejection violated, pairing a `constraintId` drawn from the published
`RULE_CONSTRAINTS` with the message that reports it.

The existing `errors` array SHALL continue to carry every failure message,
including those that are attributable. A consumer reading only `errors` SHALL
see what it sees today, so this is additive.

An error with no constraint behind it SHALL NOT be given one. A wrong
attribution sends a reader to a rationale that does not describe their failure,
which is worse than sending them to none.

A consumer SHALL NOT have to match on message text to recover the constraint.
Text matching rots the first time a message is rephrased, and rephrasing an
error message is not a breaking change.

#### Scenario: A mismatched rule id is attributed

- **WHEN** `verify --json` refuses a rule whose `id:` does not match its directory
- **THEN** the rule's result SHALL carry a violation with `constraintId` `sg-id-matches-directory`
- **AND** the violation's message SHALL also appear in `errors`

#### Scenario: An unattributable failure carries no id

- **WHEN** `verify --json` reports a failure that no published constraint describes
- **THEN** the message SHALL appear in `errors`
- **AND** no violation SHALL be reported for it

#### Scenario: A passing rule reports no violations

- **WHEN** `verify --json` accepts a rule
- **THEN** its violations SHALL be empty
