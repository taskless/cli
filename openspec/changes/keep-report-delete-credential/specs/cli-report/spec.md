## MODIFIED Requirements

### Requirement: A published report is recorded and summarized

On a 201 response the CLI SHALL write `.taskless/reports/<YYYY-MM-DD_HHMMSS>.json` (UTC) holding the report URL, the delete credential exactly as the service returned it, and the expiry. When a record by that name already exists, the CLI SHALL instead write `<YYYY-MM-DD_HHMMSS>_<n>.json`, with the smallest `n` from 2 upward that is free, and SHALL NOT overwrite any existing record. When the record cannot be written at all, the report is live and the record was its only copy of the delete credential, so the CLI SHALL exit non-zero with `REPORT_RECORD_FAILED`, with a message stating that the report is live and giving its URL and its delete credential; with `--json` the error envelope SHALL also carry them as `url` and `deleteUrl`, with the expiry as `expiresAt`. Otherwise it SHALL then print a brief summary rendered from a CLI template: one line per rule giving its title and tier; when the report carries `findings`, a line stating how many problems the rules found in how many files in the code today; a line stating how many review comments across how many pull requests raised the rules' patterns over the window; the report URL; the expiry; and one sentence stating the report can be deleted after review. The summary SHALL NOT present a monthly rate. With `--json` it SHALL instead print a JSON object carrying the URL, the expiry, the record's path, and the rendered summary. When the record is written, the delete credential SHALL NOT appear on stdout in either form.

#### Scenario: The record is written

- **WHEN** a publish succeeds
- **THEN** exactly one new file SHALL exist under `.taskless/reports/` holding the URL, the delete credential, and the expiry

#### Scenario: A taken record name moves to a suffix

- **WHEN** a publish succeeds and `.taskless/reports/2026-10-13_142200.json` already exists for the same second
- **THEN** the record SHALL be written as `2026-10-13_142200_2.json`
- **AND** the existing record SHALL be unchanged
- **AND** `taskless report --delete 2026-10-13_142200_2.json` SHALL accept it

#### Scenario: A record that cannot be written keeps the credential

- **WHEN** a publish succeeds and `.taskless/reports/` cannot be written
- **THEN** the command SHALL exit non-zero with `REPORT_RECORD_FAILED`
- **AND** its output SHALL contain the report URL and the delete credential, with or without `--json`

#### Scenario: The summary names the link and the way back

- **WHEN** a publish succeeds without `--json`
- **THEN** stdout SHALL list each published rule's title and tier
- **AND** SHALL print the report URL
- **AND** SHALL state that the report can be deleted after review

#### Scenario: The summary leads with what the rules found

- **WHEN** a publish succeeds and the report carries `findings` of 342 violations in 118 files
- **THEN** the summary SHALL state that the rules found 342 problems in 118 files in the code today

#### Scenario: The summary omits findings it does not have

- **WHEN** a publish succeeds and the report carries no `findings`
- **THEN** the summary SHALL NOT state a count of problems found

#### Scenario: The delete credential stays on disk

- **WHEN** a publish succeeds and its record is written, with or without `--json`
- **THEN** stdout SHALL NOT contain the delete credential
