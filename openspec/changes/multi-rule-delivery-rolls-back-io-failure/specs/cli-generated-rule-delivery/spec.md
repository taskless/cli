## MODIFIED Requirements

### Requirement: Every rule of a request is checked before any is written

When a generation request produced more than one rule, the CLI SHALL verify every rule's
signatures, and check every rule's id, engine, and file set as a writable rule, before writing
any of them. A request in which any rule is refused SHALL leave `.taskless/rules/` as it was and
exit with an error. A refusal from these checks SHALL carry an error code: `RULE_UNSUPPORTED` for
an engine this CLI does not know, and `RULE_GENERATION_FAILED` otherwise.

The writes SHALL be all or nothing as well. The CLI SHALL stage every rule in full under
`.taskless/`, on the same filesystem as `.taskless/rules/`, before moving any into place. When an
IO failure occurs while staging or moving, the CLI SHALL undo every move already made, restoring
any version of a rule it replaced, SHALL remove the staging directory, and SHALL exit with
`RULE_GENERATION_FAILED`, leaving `.taskless/rules/` as it was. When the undo itself cannot
finish, the CLI SHALL keep the staging directory and SHALL name where each replaced version is.

A process killed outright between two moves is outside this guarantee: each move is atomic, the
sequence of them is not, and no rollback runs. The replaced versions SHALL then still be on disk
in the staging directory.

#### Scenario: A later rule with an unknown engine writes nothing

- **WHEN** a request produced two rules and the second declares an engine the CLI does not know
- **THEN** the CLI SHALL exit with `RULE_UNSUPPORTED`
- **AND** `.taskless/rules/` SHALL be unchanged, including the first rule's directory

#### Scenario: A later rule with an unsafe path writes nothing

- **WHEN** a request produced two rules and the second delivers a path containing `..`
- **THEN** the CLI SHALL exit with `RULE_GENERATION_FAILED`, naming the second rule
- **AND** `.taskless/rules/` SHALL be unchanged

#### Scenario: A write that fails on a later rule restores the earlier one

- **WHEN** a request produced two rules, the first replaces an older version already on disk, and moving the second into place fails with an IO error
- **THEN** the CLI SHALL exit with `RULE_GENERATION_FAILED`, naming the second rule
- **AND** `.taskless/rules/` SHALL be byte-identical to how it started, including every file of the older version
- **AND** no staging directory SHALL remain under `.taskless/`

#### Scenario: A write that fails on a later rule removes a new earlier one

- **WHEN** a request produced two rules, the first is new, and moving the second into place fails with an IO error
- **THEN** the CLI SHALL exit with `RULE_GENERATION_FAILED`
- **AND** the first rule's directory SHALL NOT exist
- **AND** no staging directory SHALL remain under `.taskless/`
