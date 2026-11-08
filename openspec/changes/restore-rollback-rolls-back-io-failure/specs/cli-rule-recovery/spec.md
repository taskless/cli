## MODIFIED Requirements

### Requirement: Recovery commands report under --json

Under `--json`, `rule restore` and `rule rollback` SHALL print
`{ success: true, ruleId, revisionId, files, notices? }` on success and the standardized error
envelope `{ ok: false, code, message }` otherwise, with `code` distinguishing
`RULE_RECOVERY_NOT_IN_PLAN`, `RULE_NOT_FOUND`, `REVISION_NOT_FOUND`, `RULE_RESTORE_MISMATCH`,
`RULE_RESTORE_FAILED`, `AUTH_REQUIRED`, and `NETWORK_ERROR`.

#### Scenario: A refusal is machine-readable

- **WHEN** `rule restore --json` is refused for the plan
- **THEN** stdout SHALL be `{ ok: false, code: "RULE_RECOVERY_NOT_IN_PLAN", message }` with `message` carrying the server's guidance

## ADDED Requirements

### Requirement: A restore or rollback that cannot be written leaves the rule as it was

`rule restore` and `rule rollback` SHALL write the served rule through the same staged delivery
as `rule create`: the rule SHALL be written in full under `.taskless/`, on the same filesystem as
`.taskless/rules/`, and then moved over its rule directory, with any version already there moved
aside first. When an IO failure occurs while staging or moving, the CLI SHALL move back any
version it moved aside, SHALL remove the staging directory, and SHALL exit with
`RULE_RESTORE_FAILED`, leaving `.taskless/rules/` as it was. When the move back itself cannot
finish, the CLI SHALL keep the staging directory and SHALL name where the replaced version is.

A served set that passed verification but is not a writable rule, such as a fixture at an unsafe
path, SHALL be refused with `RULE_RESTORE_MISMATCH`, writing nothing.

A process killed outright between the two moves is outside this guarantee: each move is atomic,
the pair is not, and no rollback runs. The replaced version SHALL then still be on disk in the
staging directory.

#### Scenario: A restore that fails to write leaves the edited rule

- **WHEN** `rule restore --json` restores an edited rule and moving the served rule into place fails with an IO error
- **THEN** stdout SHALL be `{ ok: false, code: "RULE_RESTORE_FAILED", message }`
- **AND** `.taskless/rules/` SHALL be byte-identical to how it started
- **AND** no staging directory SHALL remain under `.taskless/`

#### Scenario: A restore of a missing rule that fails to write leaves no rule

- **WHEN** `rule restore --json` restores a missing rule and moving it into place fails with an IO error
- **THEN** the CLI SHALL exit with `RULE_RESTORE_FAILED`
- **AND** the rule's directory SHALL NOT exist
- **AND** no staging directory SHALL remain under `.taskless/`

#### Scenario: A rollback that fails to write leaves the current version

- **WHEN** `rule rollback --json` replaces a rule already on disk and moving the served revision into place fails with an IO error
- **THEN** the CLI SHALL exit with `RULE_RESTORE_FAILED`
- **AND** `.taskless/rules/` SHALL be byte-identical to how it started, including entries the served set does not name

#### Scenario: A read-only file in the replaced version does not split the rule

- **WHEN** `rule rollback` replaces a rule whose fixture file is read-only
- **THEN** the rollback SHALL succeed
- **AND** the rule directory SHALL hold exactly the served revision's files

#### Scenario: A served set that cannot be written is a mismatch

- **WHEN** a served set passes verification but carries a fixture at a path containing `..`
- **THEN** the CLI SHALL exit with `RULE_RESTORE_MISMATCH` and write nothing
