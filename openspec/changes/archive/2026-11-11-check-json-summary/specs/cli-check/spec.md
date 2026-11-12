## REMOVED Requirements

### Requirement: Check subcommand formats JSON output when --json is set

**Reason**: It described a JSONL stream, one finding per line, that `check --json` has not printed for a long time. It prints one JSON object, and this change adds a key to it.

**Migration**: Replaced by "Check subcommand prints one JSON envelope when --json is set", which states the envelope as printed.

## ADDED Requirements

### Requirement: Check subcommand prints one JSON envelope when --json is set

When the `--json` flag is set, the CLI SHALL write one JSON object to stdout: `{ success, results, summary }`, plus the optional `skipped`, `failures`, `notices`, `entitlement`, `integrity` and `runDirectory` keys. `results` SHALL hold every finding, each parsing against the published `findingSchema`. `summary` SHALL be present on every run. `results` SHALL be present on every run except one given `--summary`.

#### Scenario: JSON output carries every finding

- **WHEN** the `--json` flag is set and the scanner produces results
- **THEN** stdout SHALL be a single JSON object whose `results` array holds one entry per finding
- **AND** its `summary` SHALL count the same findings

#### Scenario: JSON output with no issues

- **WHEN** the `--json` flag is set and the scanner produces zero results
- **THEN** `results` SHALL be an empty array
- **AND** `summary.total` SHALL be 0 and `summary.rules` SHALL be empty

### Requirement: Check reports finding counts per rule

`check --json` SHALL carry a `summary` with the total number of findings, the number of distinct files they are in, the counts by severity, and a `rules` array. Every severity SHALL be present in a count, zero included. `rules` SHALL hold one entry per rule with at least one finding, keyed by `engine` and `ruleId`, carrying that rule's total, distinct files and counts by severity, ordered by total descending and then by `ruleId`. Two engines holding the same rule id SHALL be two entries. A rule with no findings SHALL NOT be listed, because a finding list cannot tell a rule that found nothing from one that did not run.

#### Scenario: Summary counts per rule

- **WHEN** `check --json` runs and one error rule and one warning rule each match once in the same file
- **THEN** `summary` SHALL report a total of 2 across 1 file, with 1 error and 1 warning
- **AND** `summary.rules` SHALL hold one entry for each rule, each with a total of 1

#### Scenario: Summary on a project with no rules

- **WHEN** `check --json` runs in a project with no rules configured
- **THEN** `summary` SHALL be present with a total of 0 and an empty `rules`

### Requirement: Check --summary reports counts without findings

`check --summary` SHALL report the run's counts in place of its findings. Under `--json` it SHALL omit `results` and keep every other key, `summary` included. Without `--json` it SHALL print one line per rule that fired, with its counts by severity and its distinct files, then a total line. The exit code SHALL be the same as without `--summary`.

#### Scenario: JSON summary only

- **WHEN** `check --json --summary` runs and a rule of error severity matches
- **THEN** stdout SHALL be a JSON object with `success` and `summary` and no `results`
- **AND** the process SHALL exit with code 1

#### Scenario: Text summary

- **WHEN** `check --summary` runs without `--json` and one error rule and one warning rule each match once
- **THEN** stdout SHALL include a line per rule naming its engine, its id, its counts and its files
- **AND** stdout SHALL include `2 issues (1 error, 1 warning) from 2 rules across 1 file`
- **AND** stdout SHALL NOT include the matched code

### Requirement: Check and verify share one finding schema

A finding in `check --json`'s `results` and a finding in `verify --json`'s `rules[].findings` SHALL both parse against the one `findingSchema` published from `@taskless/cli/schemas`. `verify`'s findings SHALL extend it with `bucket` and SHALL NOT redeclare its fields.

#### Scenario: A finding from each command parses against one schema

- **WHEN** `check --json` and `verify --json` run against a project whose rule fires in both the code and the rule's `fail/` fixture
- **THEN** a finding from each SHALL parse against the published `findingSchema`
