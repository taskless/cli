## ADDED Requirements

### Requirement: Migration 7 ignores scratch request files

Migration `7` SHALL add `/.tmp-*` to `.taskless/.gitignore` through the shared gitignore helper, so that the scratch request files agent recipes write under `.taskless/` (for example `.tmp-rule-request.json`, `.tmp-improve-request.json`, `.tmp-feedback.json`) are never committed. It SHALL NOT modify migration `1` or any other shipped migration; a fresh scaffold reaches the same `.gitignore` by running migrations `1` through `7` in order.

#### Scenario: An existing scaffold gains the ignore line

- **WHEN** `taskless.json` records version 6 and the CLI bootstraps `.taskless/`
- **THEN** migration 7 SHALL run
- **AND** `.taskless/.gitignore` SHALL contain a `/.tmp-*` line
- **AND** `taskless.json` SHALL record version 7

#### Scenario: A fresh scaffold ends with the same file

- **WHEN** `.taskless/` does not exist and the CLI bootstraps it
- **THEN** `.taskless/.gitignore` SHALL contain `.env.local.json`, `/sgconfig.yml`, and `/.tmp-*`
- **AND** migration 1's own source SHALL be unchanged from the previous release

#### Scenario: Migration 7 is idempotent

- **WHEN** `.taskless/.gitignore` already contains `/.tmp-*` and migration 7 runs
- **THEN** the file SHALL contain exactly one `/.tmp-*` line afterwards
