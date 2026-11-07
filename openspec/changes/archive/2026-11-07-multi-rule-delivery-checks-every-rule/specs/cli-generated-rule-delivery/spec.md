## ADDED Requirements

### Requirement: Every rule of a request is checked before any is written

When a generation request produced more than one rule, the CLI SHALL verify every rule's
signatures, and check every rule's id, engine, and file set as a writable rule, before writing
any of them. A request in which any rule is refused SHALL leave `.taskless/rules/` as it was and
exit with an error. A refusal from these checks SHALL carry an error code: `RULE_UNSUPPORTED` for
an engine this CLI does not know, and `RULE_GENERATION_FAILED` otherwise.

An IO failure while writing, after every rule passed, is outside this guarantee.

#### Scenario: A later rule with an unknown engine writes nothing

- **WHEN** a request produced two rules and the second declares an engine the CLI does not know
- **THEN** the CLI SHALL exit with `RULE_UNSUPPORTED`
- **AND** `.taskless/rules/` SHALL be unchanged, including the first rule's directory

#### Scenario: A later rule with an unsafe path writes nothing

- **WHEN** a request produced two rules and the second delivers a path containing `..`
- **THEN** the CLI SHALL exit with `RULE_GENERATION_FAILED`, naming the second rule
- **AND** `.taskless/rules/` SHALL be unchanged
