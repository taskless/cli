## MODIFIED Requirements

### Requirement: The agent supplies session facts, not a report

`taskless report --from <path>` SHALL read a facts file, not a ReportV1. The facts file SHALL carry only what the agent knows from its session: the history counts and the window they were mined over, per-rule titles, an `explain` for every rule (the agent's take, in one or two sentences, on why the rule is worth holding in this codebase), and `surfaced` counts (the merged pull requests in the window whose review raised the rule's pattern, and the review comments that asked for it), optionally per-rule `sources` (the kinds of source the rule came from) and `evidence` (a count of explicit call-outs per kind), rules authored into an existing linter (`legacy` tier), runtime-shaped candidates the agent did not author (`cloud` tier) each with `estimatedViolations`, the agent's estimate of how many instances of the candidate's pattern are in the code today, the agent's own redaction counts, and the fixtures it elects to withhold. The facts file SHALL NOT accept any value input: no token, call, price, time, or rate estimate. The CLI SHALL merge the facts with what it establishes itself, and SHALL treat its own values as authoritative for every field it can establish.

Every published rule SHALL carry a `state`. Rules under `.taskless/rules/` and `legacy` rules SHALL be `written`; `cloud` candidates from the facts file SHALL be `candidate`.

The facts file SHALL be validated against a published facts schema before anything else happens. The `report` recipe SHALL embed that schema.

Every rule in the facts, in `rules`, `legacy`, or `cloud`, MAY carry `sources` and `evidence` in the shape ReportV1 gives them, and the CLI SHALL take their kinds from the vendored ReportV1 schema rather than from a list of its own. The CLI SHALL carry each rule's `sources` and `evidence` to the published rule unchanged, and SHALL add neither field to a rule whose facts omit it. Before any network call, the CLI SHALL refuse under `REPORT_INVALID`, naming the rule and the field, facts in which: `sources` is given on some rules but not all; a rule lists a kind twice; a rule lists `reviews` without `surfaced.reviewComments` above zero; a rule lists `commits`, `issues`, `docs`, or `tests` without an `evidence` count for that kind; or a rule carries an `evidence` count for a kind its `sources` does not list, or `evidence` without `sources`. A rule MAY list `agent-files` or `conventions` without a count, and MAY carry `surfaced` without listing `reviews`.

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
- **AND** it SHALL carry the agent's `estimatedViolations`

#### Scenario: A candidate without an estimate is refused

- **WHEN** the facts file lists a `cloud` candidate with no `estimatedViolations`
- **THEN** the command SHALL exit non-zero with `REPORT_INVALID`

#### Scenario: Every rule carries the agent's explanation

- **WHEN** the facts give a local rule, a `legacy` rule, and a `cloud` candidate each an `explain`
- **THEN** the published report SHALL carry each one's `explain` on that rule

#### Scenario: A rule without an explanation is refused

- **WHEN** the facts give any rule, in `rules`, `legacy`, or `cloud`, no `explain`, or one that is blank or longer than 1000 characters
- **THEN** the command SHALL exit non-zero with `REPORT_INVALID`

#### Scenario: Value inputs are not accepted

- **WHEN** the facts file includes `estimates`, `contextTokens`, `callsPerCatch`, or `complexity`
- **THEN** the command SHALL refuse the field as unknown under `REPORT_INVALID`

#### Scenario: Fix counts are not accepted

- **WHEN** the facts file gives a rule `fixed`, `fixedBasis`, or `origin`
- **THEN** the command SHALL refuse the field as unknown under `REPORT_INVALID`

#### Scenario: Sources and evidence are carried to the report

- **WHEN** the facts give a local rule `sources: ["commits", "docs"]` and `evidence: { "commits": 4, "docs": 1 }`
- **THEN** the published rule SHALL carry exactly that `sources` and that `evidence`

#### Scenario: Facts without sources publish as before

- **WHEN** no rule in the facts carries `sources` or `evidence`
- **THEN** no published rule SHALL carry `sources` or `evidence`
- **AND** the payload SHALL otherwise be the one the same facts produced before this change

#### Scenario: Sources must be given on every rule or on none

- **WHEN** the facts give one rule `sources` and another rule none
- **THEN** the command SHALL exit non-zero with `REPORT_INVALID`
- **AND** SHALL NOT perform any network call

#### Scenario: A counted kind needs its count

- **WHEN** a rule lists `commits` in `sources` and carries no `evidence.commits`
- **THEN** the command SHALL exit non-zero with `REPORT_INVALID` naming that rule and `evidence.commits`

#### Scenario: A count needs its kind

- **WHEN** a rule carries `evidence.tests` and its `sources` does not list `tests`
- **THEN** the command SHALL exit non-zero with `REPORT_INVALID` naming that rule and `evidence.tests`

#### Scenario: Reviews need a review comment

- **WHEN** a rule lists `reviews` and its `surfaced.reviewComments` is 0
- **THEN** the command SHALL exit non-zero with `REPORT_INVALID` naming that rule

#### Scenario: Original kinds may be listed without a count

- **WHEN** a rule lists `agent-files` and `conventions` and carries no `evidence`
- **THEN** the command SHALL NOT refuse it for that

### Requirement: A published report is recorded and summarized

On a 201 response the CLI SHALL write `.taskless/reports/<YYYY-MM-DD_HHMMSS>.json` (UTC) holding the report URL, the delete credential exactly as the service returned it, and the expiry. When a record by that name already exists, the CLI SHALL instead write `<YYYY-MM-DD_HHMMSS>_<n>.json`, with the smallest `n` from 2 upward that is free, and SHALL NOT overwrite any existing record. When the record cannot be written at all, the report is live and the record was its only copy of the delete credential, so the CLI SHALL exit non-zero with `REPORT_RECORD_FAILED`, with a message stating that the report is live and giving its URL and its delete credential; with `--json` the error envelope SHALL also carry them as `url` and `deleteUrl`, with the expiry as `expiresAt`. Otherwise it SHALL then print a brief summary rendered from a CLI template: one line per rule giving its title and tier, followed by the rule's evidence totals; when the report carries `findings`, a line stating how many problems the rules found in how many files in the code today; a line stating how many review comments across how many pull requests raised the rules' patterns over the window; the report URL; the expiry; and one sentence stating the report can be deleted after review. A rule's evidence totals SHALL be two, worded as the report page words them: "N times in reviews", the sum of `surfaced.reviewComments`, `evidence.commits`, and `evidence.issues`; and "N times in conventions", the sum of `evidence["agent-files"]`, `evidence.conventions`, `evidence.docs`, and `evidence.tests`. Each SHALL be shown only when above zero, the larger first and reviews first on a tie, with "1 time" for one; a rule with neither shows its title and tier alone. The summary SHALL NOT present a monthly rate. With `--json` it SHALL instead print a JSON object carrying the URL, the expiry, the record's path, and the rendered summary. When the record is written, the delete credential SHALL NOT appear on stdout in either form.

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

#### Scenario: The summary gives each rule its evidence totals

- **WHEN** a publish succeeds and a rule carries `surfaced.reviewComments` of 2, `evidence.commits` of 4, and `evidence.docs` of 1
- **THEN** that rule's line SHALL state "6 times in reviews, 1 time in conventions"

#### Scenario: Conventions lead when they are larger

- **WHEN** a publish succeeds and a rule carries no `surfaced` and `evidence` of `{ "agent-files": 2, "tests": 3 }`
- **THEN** that rule's line SHALL state "5 times in conventions" and no reviews total

#### Scenario: A rule without evidence shows no totals

- **WHEN** a publish succeeds and a rule carries no `evidence` and no review comments
- **THEN** that rule's line SHALL give its title and tier and no totals

#### Scenario: The delete credential stays on disk

- **WHEN** a publish succeeds and its record is written, with or without `--json`
- **THEN** stdout SHALL NOT contain the delete credential

### Requirement: The report recipe drives publishing and deletion

The CLI SHALL embed a `report` recipe following the canonical recipe template. It SHALL instruct the agent to: run `taskless report` and read `missing`; supply each missing fact from its session, writing the facts to `.taskless/.tmp-report.json`; give every rule an `explain` of one or two sentences saying what goes wrong without the rule and what holding it buys, grounded in what the session saw and carrying no counts; count each rule's `surfaced` by the method the recipe states; give every rule `sources` and `evidence`, counted by the method the recipe states; give each cloud candidate an `estimatedViolations` from what it saw while mining; run `taskless report --from` that path; on `REPORT_INSUFFICIENT`, ask the user only what would let it author the rules or establish the facts the refusal names, then retry; on success, show the CLI's summary as printed and tell the user the report can be deleted after review if they ask; delete the facts file; and on a request to delete, run `taskless report --delete` with the record. The recipe SHALL embed the facts schema and SHALL state that tskl.es does not redact, so anything the agent cannot vouch for is to be withheld.

The counting method SHALL be a single procedure: a pull request counts toward a rule's `surfaced.prs` when it merged inside the window and at least one review comment on it asked for the change the rule enforces; a comment counts toward `surfaced.reviewComments` when a reader of that comment would say it asks for that change. Only review comments count toward `surfaced`: the recipe SHALL state that a fix-up commit, a `git blame` date, or a finding in the code today is not a review comment and SHALL NOT be counted toward either field. Every author counts: a comment from a bot account or from the pull request's own author SHALL count the same as a reviewer's, since each one spends cycles, tokens, time, or money. The recipe SHALL direct the agent to judge each comment by reading it, not by matching keywords.

The recipe SHALL define, for every kind `evidence` counts, what one call-out is: a line in an agent file (`agent-files`); a code comment such as TODO, FIXME, XXX or HACK asking for the pattern (`conventions`); a passage in the documentation, doc annotations such as `@deprecated` included (`docs`); a test that pins the behaviour (`tests`); a commit inside the window that made the fix (`commits`); and an issue, ticket, recorded decision, or comment on one that asked for it (`issues`). It SHALL state that code which merely follows a pattern is not a call-out, that commits are counted inside the window while every other kind is counted as found at publish, that `reviews` has no `evidence` count because `surfaced.reviewComments` is its count, that a listed `commits`, `issues`, `docs`, or `tests` needs its count, and that `sources` and `evidence` name kinds only, never a path, file name, commit, or issue.

Whenever the agent restates the report's numbers in its own words, the recipe SHALL require it to keep counts the CLI measured in the code today, counts mined from review history over the window, and its own estimates for cloud candidates apart, and to say which is which.

The recipe SHALL NOT ask the agent for any value input: tskl.es estimates reviewer time, agent tokens, and dollars itself.

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

#### Scenario: Only review comments count as surfaced

- **WHEN** an agent runs `taskless agent report`
- **THEN** the `## Counting evidence` section SHALL state that a fix-up commit, a `git blame` date, and a finding in the code today are not review comments and do not count toward `surfaced`

#### Scenario: The recipe defines a call-out for every counted kind

- **WHEN** an agent runs `taskless agent report`
- **THEN** the `## Counting evidence` section SHALL state what one call-out is for `agent-files`, `conventions`, `docs`, `tests`, `commits`, and `issues`
- **AND** SHALL state that code which merely follows a pattern is not counted
- **AND** SHALL state that `sources` and `evidence` name kinds, never paths, files, commits, or issues

#### Scenario: The recipe asks for an explanation of every rule

- **WHEN** an agent runs `taskless agent report`
- **THEN** stdout SHALL contain an `## Explaining a rule` section asking for one or two sentences on why each rule, written or candidate, is worth holding in this codebase
- **AND** that section SHALL tell the agent to leave counts out of `explain`

#### Scenario: The recipe asks for a candidate estimate and no value input

- **WHEN** an agent runs `taskless agent report`
- **THEN** the step that supplies facts SHALL direct the agent to give each cloud candidate an `estimatedViolations`
- **AND** SHALL NOT mention `contextTokens` or `callsPerCatch`
