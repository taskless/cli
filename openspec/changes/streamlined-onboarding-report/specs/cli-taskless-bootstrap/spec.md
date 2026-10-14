## MODIFIED Requirements

### Requirement: Onboarded field semantics are 3-state and consent-gated

The optional `install.onboarded` boolean field on the install manifest SHALL be interpreted by all readers as three meaningful states:

| Value   | Meaning                                                               |
| ------- | --------------------------------------------------------------------- |
| absent  | Never explicitly onboarded (the post-install default)                 |
| `false` | Explicitly reset (treated equivalently to absent for gating purposes) |
| `true`  | The user agreed to onboarding and the onboarding flow wrote its rules |

Consent is the user's yes to the onboarding recipe's opening question. The agent records it by running `taskless onboard --mark-complete` once the rules are written, without a second confirmation.

The field SHALL only be written by the `taskless onboard --mark-complete` subcommand. No other CLI code path (including `taskless init`, the wizard, `taskless report`, and any future migration) SHALL write or set this field automatically. The field MAY be edited manually by an advanced user; such edits are out of scope for the CLI's guarantees.

#### Scenario: Absent and false both gate as "not onboarded"

- **WHEN** any consumer of the manifest reads `install.onboarded`
- **AND** the field is absent OR `false`
- **THEN** the consumer SHALL treat the user as not yet onboarded for any gating purpose

#### Scenario: True gates as "onboarded"

- **WHEN** any consumer of the manifest reads `install.onboarded`
- **AND** the field is `true`
- **THEN** the consumer SHALL treat the user as onboarded

#### Scenario: No CLI path writes onboarded except mark-complete

- **WHEN** the codebase is searched for writes to `install.onboarded`
- **THEN** the only producer SHALL be the `taskless onboard --mark-complete` subcommand

#### Scenario: Publishing a report does not mark onboarding complete

- **WHEN** `taskless report --from` publishes a report in a repository whose `install.onboarded` is absent
- **THEN** `install.onboarded` SHALL still be absent afterwards

## ADDED Requirements

### Requirement: Migration 11 creates the reports directory and ignores it

Migration `11` SHALL create `.taskless/reports/` holding a short stub that says what the directory records, and SHALL add `/reports/` to `.taskless/.gitignore` through the shared gitignore helper. Each record in the directory holds a credential that deletes a page anyone with its link can view, so the directory SHALL never be committed. The migration SHALL NOT modify any shipped migration; a fresh scaffold reaches the same state by running migrations `1` through `11` in order.

#### Scenario: An existing scaffold gains the directory and the ignore line

- **WHEN** `taskless.json` records version 10 and the CLI bootstraps `.taskless/`
- **THEN** migration 11 SHALL run
- **AND** `.taskless/reports/` SHALL exist with its stub
- **AND** `.taskless/.gitignore` SHALL contain a `/reports/` line
- **AND** `taskless.json` SHALL record version 11

#### Scenario: A fresh scaffold ends in the same state

- **WHEN** `.taskless/` does not exist and the CLI bootstraps it
- **THEN** `.taskless/reports/` SHALL exist
- **AND** `.taskless/.gitignore` SHALL contain `/reports/`

#### Scenario: Migration 11 is idempotent

- **WHEN** `.taskless/reports/` already exists with records in it and `.taskless/.gitignore` already contains `/reports/`, and migration 11 runs
- **THEN** every existing record SHALL be unchanged
- **AND** the file SHALL contain exactly one `/reports/` line afterwards
