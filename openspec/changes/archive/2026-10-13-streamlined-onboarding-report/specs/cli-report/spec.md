## Purpose

Defines `taskless report`: the command that turns a repository's Taskless rules, plus what the agent learned in its session, into a redacted ReportV1 published to tskl.es as an unlisted page, and the `report` agent topic that drives it.

## ADDED Requirements

### Requirement: Report subcommand exists with a draft mode, a publish mode, and delete

The CLI SHALL provide a `taskless report` subcommand accepting the standard `--dir`/`-d` working-directory flag. Invoked with no mode flag it SHALL print a draft. Invoked with `--from <path>` it SHALL publish. `taskless report --delete <record>` SHALL delete a previously published report. `--from` and `--delete` SHALL be mutually exclusive; supplying both SHALL exit non-zero with `INVALID_INPUT`. The subcommand SHALL require no authentication in any mode, and SHALL bootstrap `.taskless/` before reading or writing under it.

#### Scenario: Report is registered

- **WHEN** a user runs `taskless --help`
- **THEN** `report` SHALL appear in the list of subcommands

#### Scenario: Report works logged out

- **WHEN** a user who has never logged in runs `taskless report` or `taskless report --from <path>`
- **THEN** the command SHALL NOT prompt for or require authentication

### Requirement: The draft states what the CLI knows and what the agent must supply

`taskless report` with no mode flag SHALL print a single JSON object to stdout and exit 0. The object SHALL contain every report field the CLI can establish from the working directory: the producer (`kind: "cli"` and this build's version), the scope derived from the repository's `origin` remote, one entry per rule directory under `.taskless/rules/` with its id, engine, tier, language, and test status and fixtures, and the default projection inputs. It SHALL also contain `missing`, a list naming each fact the agent must supply before the report can publish. A fact the CLI can establish SHALL NOT appear in `missing`.

The draft SHALL NOT perform any network call.

#### Scenario: A repository with local rules

- **WHEN** `.taskless/rules/` holds three `sg` rules and one `vale` rule and the user runs `taskless report`
- **THEN** stdout SHALL be a JSON object listing four rules, each with `tier: "cli"`, its engine, and its test status
- **AND** `missing` SHALL name the session facts still required, including `history` and the projection estimates

#### Scenario: A GitHub origin becomes a GitHub scope

- **WHEN** the repository's `origin` is a GitHub remote
- **THEN** the draft's scope SHALL carry `provider: "github"` with the owner, repository, and canonical URL

#### Scenario: Any other origin becomes an unnamed scope

- **WHEN** the repository has no `origin`, or a non-GitHub `origin`
- **THEN** the draft's scope SHALL carry `provider: "none"` with a label

#### Scenario: The draft is offline

- **WHEN** `taskless report` runs with no network available
- **THEN** it SHALL print the draft and exit 0

### Requirement: The agent supplies session facts, not a report

`taskless report --from <path>` SHALL read a facts file, not a ReportV1. The facts file SHALL carry only what the agent knows from its session: the history counts and the window they were mined over, per-rule titles and origin counts and fix counts with their basis, rules authored into an existing linter (`legacy` tier), runtime-shaped candidates the agent did not author (`cloud` tier), the agent's estimates of context tokens per session and calls per catch, the agent's own redaction counts, and the fixtures it elects to withhold. The CLI SHALL merge the facts with what it establishes itself, and SHALL treat its own values as authoritative for every field it can establish.

The facts file SHALL be validated against a published facts schema before anything else happens. The `report` recipe SHALL embed that schema.

#### Scenario: Facts cannot set what the CLI knows

- **WHEN** the facts file gives a rule under `.taskless/rules/` an engine, a language, or a test status
- **THEN** the command SHALL refuse the field as unknown under `REPORT_INVALID`
- **AND** a report that publishes SHALL carry the engine, language, and test status the CLI established

#### Scenario: Malformed facts are refused before any other work

- **WHEN** the facts file is not valid JSON or fails the facts schema
- **THEN** the command SHALL exit non-zero with `REPORT_INVALID` naming each failing field
- **AND** SHALL NOT perform any network call

#### Scenario: Cloud candidates are carried as cloud tier

- **WHEN** the facts file lists a runtime-shaped candidate
- **THEN** the published report SHALL include it with `tier: "cloud"` and `engine: "runtime"`
- **AND** its tests status SHALL be `not-run`

### Requirement: The CLI computes the projection

The CLI SHALL compute `projection.perMonth` itself from the merged facts and SHALL NOT accept per-month figures from the facts file. Per-tier counts SHALL be normalized to a 30-day month over the mining window the facts declare. The projection's `inputs` SHALL carry the agent's estimates for `contextTokens` and `callsPerCatch` and the CLI's defaults for every other input.

#### Scenario: Per-month figures in the facts are not accepted

- **WHEN** the facts file includes a `perMonth` value
- **THEN** the command SHALL refuse it as an unknown field under `REPORT_INVALID`

#### Scenario: Window normalization

- **WHEN** the facts declare a 90-day window and rules in the `cli` tier with a combined fix count of 30
- **THEN** the published `projection.perMonth.agentCatches.cli` SHALL be 10

### Requirement: Publishing is gated on a meaningful report

`taskless report --from` SHALL refuse to publish unless the merged report holds at least three Taskless rules. A Taskless rule is one in the `cli` tier, or one in the `legacy` tier that the agent authored into the repository's own linter; either way, its test status SHALL be neither `fail` nor `refused`. Rules in the `cloud` tier SHALL NOT count toward the three; they are carried in addition. The projection SHALL NOT gate publishing. A refusal SHALL exit non-zero with `REPORT_INSUFFICIENT`, SHALL state how many of the required three exist, and SHALL perform no network call.

#### Scenario: Too few local rules

- **WHEN** the merged report holds two passing `sg` rules and four `cloud` candidates
- **THEN** the command SHALL exit non-zero with `REPORT_INSUFFICIENT`
- **AND** the message SHALL state that two of the required three local rules exist

#### Scenario: Legacy rules the agent wrote count

- **WHEN** the merged report holds one passing `sg` rule and two `legacy` rules the agent authored into the repository's eslint config
- **THEN** the gate SHALL count three rules and SHALL NOT refuse

#### Scenario: A small projection does not refuse

- **WHEN** the merged report holds three passing local rules and a projection near zero
- **THEN** the gate SHALL NOT refuse

#### Scenario: A failing rule does not count

- **WHEN** one of three local rules has test status `fail`
- **THEN** the gate SHALL count two local rules

### Requirement: The CLI redacts and withholds before publishing

tskl.es performs no redaction of its own. Before publishing, the CLI SHALL scan every fixture and every string supplied by the facts file for secrets, email addresses, host names, IP addresses, and phone numbers. A fixture containing a match SHALL be withheld in full, never partially masked: its code SHALL be omitted, its side SHALL be recorded in that rule's `withheld`, and `redaction.withheldFixtures` SHALL count it. A match in any other agent-supplied string SHALL refuse the publish with `REPORT_REDACTION`, naming the field, so the agent can rewrite it. A fixture whose code exceeds the schema's length limit SHALL be withheld the same way.

`redaction.counts` SHALL be the sum of the agent's declared counts and the CLI's own matches per category. `redaction.policyVersion` SHALL identify the CLI's redaction policy.

#### Scenario: A secret in a fixture withholds the fixture

- **WHEN** a rule's failing fixture contains an AWS access key
- **THEN** the published rule SHALL have `tests.fail: null` and `"fail"` in `tests.withheld`
- **AND** `redaction.counts.secret` SHALL include that match
- **AND** no part of the fixture SHALL appear in the published payload

#### Scenario: An email in a rule title refuses the publish

- **WHEN** the facts give a rule a title containing an email address
- **THEN** the command SHALL exit non-zero with `REPORT_REDACTION` naming that rule's title
- **AND** SHALL perform no network call

#### Scenario: Every agent-supplied rule string is screened

- **WHEN** the facts give a legacy rule a `tool` or `language`, or a cloud candidate a `language` or `id`, containing an email address or a host name
- **THEN** the command SHALL exit non-zero with `REPORT_REDACTION` naming that field

#### Scenario: The agent's counts are carried

- **WHEN** the facts declare `person: 2` and the CLI matches no person names
- **THEN** `redaction.counts.person` SHALL be 2

### Requirement: The payload is validated against the vendored ReportV1 schema before it is sent

The CLI SHALL carry a vendored copy of the ReportV1 schema published at `https://tskl.es/api/v1/schema`, refreshed by a generate script and committed. The assembled payload SHALL be validated against it, and SHALL be measured against the publish size limit, before any network call. A payload that fails either check SHALL NOT be sent.

#### Scenario: An invalid payload is never sent

- **WHEN** the assembled payload fails the vendored schema
- **THEN** the command SHALL exit non-zero with `REPORT_INVALID` naming each failing path
- **AND** SHALL perform no network call

#### Scenario: An oversized payload is never sent

- **WHEN** the assembled payload exceeds 262,144 bytes
- **THEN** the command SHALL exit non-zero with `REPORT_TOO_LARGE`
- **AND** SHALL perform no network call

### Requirement: Publishing follows the tskl.es retry contract

The CLI SHALL publish with `POST https://tskl.es/api/v1/reports` and SHALL always publish with `private` retention. It SHALL retry only on a `publish_failed` (502) response, a bounded number of times. It SHALL NOT retry after a timeout or a dropped connection, since the report may have been published; it SHALL instead exit non-zero with `REPORT_PUBLISH_UNKNOWN`, stating that a report may exist and that re-running may create a duplicate. A `rate_limited` (429) response SHALL exit non-zero with `REPORT_RATE_LIMITED` and SHALL NOT be retried automatically. A `validation_error` (400) SHALL exit non-zero with `REPORT_INVALID` carrying the service's details.

#### Scenario: A 502 is retried

- **WHEN** the first publish attempt returns 502 and the second returns 201
- **THEN** the command SHALL succeed

#### Scenario: A timeout is not retried

- **WHEN** a publish attempt times out
- **THEN** the command SHALL NOT send a second request
- **AND** SHALL exit non-zero with `REPORT_PUBLISH_UNKNOWN`

#### Scenario: A rate limit is surfaced

- **WHEN** the publish returns 429
- **THEN** the command SHALL exit non-zero with `REPORT_RATE_LIMITED` and SHALL NOT retry

### Requirement: A published report is recorded and summarized

On a 201 response the CLI SHALL write `.taskless/reports/<YYYY-MM-DD_HHMMSS>.json` (UTC) holding the report URL, the delete credential exactly as the service returned it, and the expiry. It SHALL then print a brief summary rendered from a CLI template: one line per rule giving its title and tier, the headline projection, the report URL, the expiry, and one sentence stating the report can be deleted after review. With `--json` it SHALL instead print a JSON object carrying the URL, the expiry, the record's path, and the rendered summary. The delete credential SHALL NOT appear on stdout in either form.

#### Scenario: The record is written

- **WHEN** a publish succeeds
- **THEN** exactly one new file SHALL exist under `.taskless/reports/` holding the URL, the delete credential, and the expiry

#### Scenario: The summary names the link and the way back

- **WHEN** a publish succeeds without `--json`
- **THEN** stdout SHALL list each published rule's title and tier
- **AND** SHALL print the report URL
- **AND** SHALL state that the report can be deleted after review

#### Scenario: The delete credential stays on disk

- **WHEN** a publish succeeds, with or without `--json`
- **THEN** stdout SHALL NOT contain the delete credential

### Requirement: A published report can be deleted from its record

`taskless report --delete <record>` SHALL read the named record under `.taskless/reports/`, delete the report by sending an HTTP `DELETE` to the recorded `deleteUrl`, the URL tskl.es returned for that purpose, and on a 204 remove the record and print a one-line confirmation that says cached copies may be served for up to a day, as the tskl.es delete contract states. A 404 (`not_available`: never issued, already deleted, expired, or not yet propagated) SHALL exit non-zero with `REPORT_NOT_AVAILABLE`, SHALL NOT be retried, and SHALL keep the record. A record named outside `.taskless/reports/`, or not a `.json` file, SHALL exit non-zero with `INVALID_INPUT` without reading or removing it. A record that does not exist SHALL exit non-zero with `REPORT_NOT_FOUND`. A failed delete SHALL leave the record in place.

#### Scenario: Deleting a report

- **WHEN** a user runs `taskless report --delete 2026-10-13_142200.json` and the service confirms the deletion
- **THEN** the record SHALL be removed
- **AND** the command SHALL print a confirmation and exit 0

#### Scenario: A report tskl.es no longer has

- **WHEN** the service answers the delete with 404
- **THEN** the command SHALL exit non-zero with `REPORT_NOT_AVAILABLE`
- **AND** SHALL send no second request
- **AND** the record SHALL remain on disk

#### Scenario: A record outside the records directory is refused

- **WHEN** a user runs `taskless report --delete ../notes.json`
- **THEN** the command SHALL exit non-zero with `INVALID_INPUT`
- **AND** SHALL send no request and remove no file

#### Scenario: A failed delete keeps the credential

- **WHEN** the service refuses or cannot be reached
- **THEN** the record SHALL remain on disk
- **AND** the command SHALL exit non-zero

### Requirement: The report recipe drives the flow

The CLI SHALL embed a `report` recipe following the canonical recipe template. It SHALL instruct the agent to: run `taskless report` and read `missing`; supply each missing fact from its session, writing the facts to `.taskless/.tmp-report.json`; estimate context tokens and calls per catch from how this user's sessions actually run; run `taskless report --from` that path; on `REPORT_INSUFFICIENT`, ask the user only what would let it author the rules or establish the facts the refusal names, then retry; on success, show the CLI's summary as printed and tell the user the report can be deleted after review if they ask; delete the facts file; and on a request to delete, run `taskless report --delete` with the record. The recipe SHALL embed the facts schema and SHALL state that tskl.es does not redact, so anything the agent cannot vouch for is to be withheld.

#### Scenario: The recipe asks questions only on refusal

- **WHEN** the `report` recipe's steps are read
- **THEN** the only step that permits a question to the user SHALL be the one handling `REPORT_INSUFFICIENT`

#### Scenario: The recipe embeds the facts schema

- **WHEN** an agent runs `taskless agent report`
- **THEN** stdout SHALL open with `# Topic: report` and contain the JSON Schema for the facts file

### Requirement: Report emits intent telemetry without report content

The `report` subcommand SHALL emit `cli_report_drafted` for a draft, `cli_report_published` on a successful publish carrying only rule counts by tier and the gate's outcome, `cli_report_refused` carrying the refusal code, and `cli_report_deleted` on a successful delete. No event SHALL carry the report URL, the delete credential, any rule title, or any fixture.

#### Scenario: A publish event carries counts only

- **WHEN** a report publishes
- **THEN** PostHog SHALL receive `cli_report_published` with per-tier rule counts
- **AND** the event SHALL NOT contain the report URL or the delete credential
