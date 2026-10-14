## ADDED Requirements

### Requirement: The CLI measures what the rules find today

The CLI SHALL measure, itself, how often each written rule matches the repository's code, by running the project's static rules over the whole project as `taskless check --anonymous` would. The measurement SHALL perform no network call and SHALL NOT change `taskless check`'s own output or exit code. For each rule under `.taskless/rules/` it SHALL record `violations`, the number of results attributed to that rule, and `files`, the number of distinct files among those results. It SHALL record `findings.violations`, the sum of every rule's `violations`, and `findings.files`, the number of distinct files with at least one result of any rule, so a file that breaks several rules counts once. File identity SHALL be the path relative to the repository root.

The counts SHALL be all-or-nothing. The CLI SHALL record them only when every written rule in the report is one it ran and every result it collected is attributed to one of them. When any written rule is a `legacy` rule, or a rule under `.taskless/rules/runtime/`, or when the scan reports an engine or plan failure, or when a result names a rule id that no written rule has, the CLI SHALL record no `findings` and no rule SHALL carry `violations` or `files`. The facts file SHALL NOT supply any of these values.

#### Scenario: Every written rule is measured

- **WHEN** `.taskless/rules/` holds three `sg` rules and one `vale` rule, the facts list no `legacy` rules, and the scan finds 4, 75, 0 and 12 results for them
- **THEN** each of the four rules SHALL carry its own `violations` and `files`
- **AND** `findings.violations` SHALL be 91

#### Scenario: A file broken by two rules counts once

- **WHEN** one file holds results from two different rules, and no other file holds results
- **THEN** each of the two rules SHALL carry `files: 1`
- **AND** `findings.files` SHALL be 1

#### Scenario: A rule with no results is measured as zero

- **WHEN** a written rule under `.taskless/rules/sg/` matches nothing and every other condition for counts holds
- **THEN** that rule SHALL carry `violations: 0` and `files: 0`

#### Scenario: A legacy rule omits every count

- **WHEN** the facts list a `legacy` rule
- **THEN** the report SHALL carry no `findings`
- **AND** no rule SHALL carry `violations` or `files`

#### Scenario: A local runtime rule omits every count

- **WHEN** `.taskless/rules/runtime/` holds a rule
- **THEN** the report SHALL carry no `findings`
- **AND** no rule SHALL carry `violations` or `files`

#### Scenario: An engine failure omits every count

- **WHEN** an engine fails during the scan
- **THEN** the report SHALL carry no `findings`
- **AND** no rule SHALL carry `violations` or `files`

#### Scenario: A result the CLI cannot attribute omits every count

- **WHEN** the scan returns a result whose rule id names no rule in the report
- **THEN** the report SHALL carry no `findings`
- **AND** no rule SHALL carry `violations` or `files`

#### Scenario: Candidates never carry counts

- **WHEN** the facts list a `cloud` candidate and every written rule is measured
- **THEN** the candidate SHALL carry no `violations` or `files`
- **AND** `findings` SHALL count only the written rules

#### Scenario: The facts cannot supply counts

- **WHEN** the facts file gives a rule `violations` or `files`, or gives a top-level `findings`
- **THEN** the command SHALL refuse the field as unknown under `REPORT_INVALID`

### Requirement: The payload carries projection inputs and no rates

The CLI SHALL NOT send monthly rates. tskl.es derives them from each rule's `surfaced` counts and the window. The payload's `projection` SHALL carry only `inputs`: the agent's estimates for `contextTokens` and `callsPerCatch`, and the CLI's defaults for every other input. The facts file SHALL NOT accept rates.

#### Scenario: Rates in the facts are not accepted

- **WHEN** the facts file includes a `perMonth` value
- **THEN** the command SHALL refuse it as an unknown field under `REPORT_INVALID`

#### Scenario: The payload sends inputs only

- **WHEN** a report publishes
- **THEN** its `projection` SHALL hold `inputs` and nothing else

## MODIFIED Requirements

### Requirement: The draft states what the CLI knows and what the agent must supply

`taskless report` with no mode flag SHALL print a single JSON object to stdout and exit 0. The object SHALL contain every report field the CLI can establish from the working directory: the producer (`kind: "cli"` and this build's version), the scope derived from the repository's `origin` remote, one entry per rule directory under `.taskless/rules/` with its id, engine, tier, language, and test status and fixtures, the default projection inputs, and what the rules find in the code today as the CLI measured it. It SHALL also contain `missing`, a list naming each fact the agent must supply before the report can publish. A fact the CLI can establish SHALL NOT appear in `missing`.

The draft SHALL NOT perform any network call.

#### Scenario: A repository with local rules

- **WHEN** `.taskless/rules/` holds three `sg` rules and one `vale` rule and the user runs `taskless report`
- **THEN** stdout SHALL be a JSON object listing four rules, each with `tier: "cli"`, its engine, and its test status
- **AND** each rule SHALL carry its measured `violations` and `files`, and the draft SHALL carry `findings`
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

`taskless report --from <path>` SHALL read a facts file, not a ReportV1. The facts file SHALL carry only what the agent knows from its session: the history counts and the window they were mined over, per-rule titles and `surfaced` counts (the merged pull requests in the window whose review raised the rule's pattern, and the review comments that asked for it), rules authored into an existing linter (`legacy` tier), runtime-shaped candidates the agent did not author (`cloud` tier), the agent's estimates of context tokens per session and calls per catch, the agent's own redaction counts, and the fixtures it elects to withhold. The CLI SHALL merge the facts with what it establishes itself, and SHALL treat its own values as authoritative for every field it can establish.

Every published rule SHALL carry a `state`. Rules under `.taskless/rules/` and `legacy` rules SHALL be `written`; `cloud` candidates from the facts file SHALL be `candidate`.

The facts file SHALL be validated against a published facts schema before anything else happens. The `report` recipe SHALL embed that schema.

#### Scenario: Facts cannot set what the CLI knows

- **WHEN** the facts file gives a rule under `.taskless/rules/` an engine, a language, a test status, or a state
- **THEN** the command SHALL refuse the field as unknown under `REPORT_INVALID`
- **AND** a report that publishes SHALL carry the engine, language, test status, and state the CLI established

#### Scenario: Malformed facts are refused before any other work

- **WHEN** the facts file is not valid JSON or fails the facts schema
- **THEN** the command SHALL exit non-zero with `REPORT_INVALID` naming each failing field
- **AND** SHALL NOT perform any network call

#### Scenario: Cloud candidates are carried as cloud tier

- **WHEN** the facts file lists a runtime-shaped candidate
- **THEN** the published report SHALL include it with `tier: "cloud"`, `engine: "runtime"`, and `state: "candidate"`
- **AND** its tests status SHALL be `not-run`

#### Scenario: Fix counts are not accepted

- **WHEN** the facts file gives a rule `fixed`, `fixedBasis`, or `origin`
- **THEN** the command SHALL refuse the field as unknown under `REPORT_INVALID`

### Requirement: A published report is recorded and summarized

On a 201 response the CLI SHALL write `.taskless/reports/<YYYY-MM-DD_HHMMSS>.json` (UTC) holding the report URL, the delete credential exactly as the service returned it, and the expiry. It SHALL then print a brief summary rendered from a CLI template: one line per rule giving its title and tier; when the report carries `findings`, a line stating how many problems the rules found in how many files in the code today; a line stating how many review comments across how many pull requests raised the rules' patterns over the window; the report URL; the expiry; and one sentence stating the report can be deleted after review. The summary SHALL NOT present a monthly rate. With `--json` it SHALL instead print a JSON object carrying the URL, the expiry, the record's path, and the rendered summary. The delete credential SHALL NOT appear on stdout in either form.

#### Scenario: The record is written

- **WHEN** a publish succeeds
- **THEN** exactly one new file SHALL exist under `.taskless/reports/` holding the URL, the delete credential, and the expiry

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

- **WHEN** a publish succeeds, with or without `--json`
- **THEN** stdout SHALL NOT contain the delete credential

### Requirement: The report recipe drives the flow

The CLI SHALL embed a `report` recipe following the canonical recipe template. It SHALL instruct the agent to: run `taskless report` and read `missing`; supply each missing fact from its session, writing the facts to `.taskless/.tmp-report.json`; count each rule's `surfaced` by the method the recipe states; estimate context tokens and calls per catch from how this user's sessions actually run; run `taskless report --from` that path; on `REPORT_INSUFFICIENT`, ask the user only what would let it author the rules or establish the facts the refusal names, then retry; on success, show the CLI's summary as printed and tell the user the report can be deleted after review if they ask; delete the facts file; and on a request to delete, run `taskless report --delete` with the record. The recipe SHALL embed the facts schema and SHALL state that tskl.es does not redact, so anything the agent cannot vouch for is to be withheld.

The counting method SHALL be a single procedure: a pull request counts toward a rule's `surfaced.prs` when it merged inside the window and at least one review comment on it asked for the change the rule enforces; a comment counts toward `surfaced.reviewComments` when a reader of that comment would say it asks for that change. Every author counts: a comment from a bot account or from the pull request's own author SHALL count the same as a reviewer's, since each one spends cycles, tokens, time, or money. The recipe SHALL direct the agent to judge each comment by reading it, not by matching keywords.

Whenever the agent restates the report's numbers in its own words, the recipe SHALL require it to keep counts the CLI measured in the code today apart from counts mined from review history over the window, and to say which is which.

#### Scenario: The recipe asks questions only on refusal

- **WHEN** the `report` recipe's steps are read
- **THEN** the only step that permits a question to the user SHALL be the one handling `REPORT_INSUFFICIENT`

#### Scenario: The recipe embeds the facts schema

- **WHEN** an agent runs `taskless agent report`
- **THEN** stdout SHALL open with `# Topic: report` and contain the JSON Schema for the facts file

#### Scenario: The recipe states one counting method

- **WHEN** an agent runs `taskless agent report`
- **THEN** stdout SHALL state how to count `surfaced.prs` and `surfaced.reviewComments`, including that bot and author comments count
- **AND** SHALL NOT ask for a count of fixes

## REMOVED Requirements

### Requirement: The CLI computes the projection

**Reason**: tskl.es now derives both monthly rates from each rule's `surfaced` counts and the window, and refuses a payload that carries `projection.perMonth`. The rates were also computed from `fixed`, which the schema removed.

**Migration**: Replaced by "The payload carries projection inputs and no rates". The facts file still supplies `window`, `surfaced`, and `estimates`; nothing the agent writes changes beyond dropping `fixed` and `fixedBasis`.
