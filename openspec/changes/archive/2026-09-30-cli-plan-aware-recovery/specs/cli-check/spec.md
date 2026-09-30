## MODIFIED Requirements

### Requirement: Check never writes to the rules tree

`taskless check` SHALL NOT create, modify, or delete anything under `.taskless/rules/`. It
SHALL NOT call restore, rollback, or rule fetch. For an `unsafe` or `missing` verdict it SHALL
name how to repair the rule: `taskless rule restore <ruleId>`, or, when the organization's
plan is known to exclude rule recovery, the git steps for the rule's directory (see
`cli-rule-recovery`, "Recovery suggestions follow the plan"). The only files
`check` writes under `.taskless/` SHALL be under `.taskless/.run/`.

#### Scenario: An edited rule is reported, not repaired

- **WHEN** reconciliation returns `unsafe` for a rule, and the organization's plan is not known to exclude rule recovery
- **THEN** `.taskless/rules/` SHALL be byte-identical before and after the run
- **AND** the output SHALL name `taskless rule restore <ruleId>`

#### Scenario: A missing rule is not fetched

- **WHEN** reconciliation returns `missing` for a rule
- **THEN** `check` SHALL NOT call any restore or fetch endpoint
- **AND** SHALL NOT create the rule's directory

#### Scenario: An edited rule on a plan without recovery is reported with git steps

- **WHEN** reconciliation returns `unsafe` for a rule and the organization's `restoreRules` entitlement is `false`
- **THEN** `.taskless/rules/` SHALL be byte-identical before and after the run
- **AND** the output SHALL give the git steps for the rule's directory and SHALL NOT name `taskless rule restore`
