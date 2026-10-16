## MODIFIED Requirements

### Requirement: The agent supplies session facts, not a report

`taskless report --from <path>` SHALL read a facts file, not a ReportV1. The facts file SHALL carry only what the agent knows from its session: the history counts and the window they were mined over, per-rule titles, an `explain` for every rule (the agent's take, in one or two sentences, on why the rule is worth holding in this codebase), and `surfaced` counts (the merged pull requests in the window whose review raised the rule's pattern, and the review comments that asked for it), rules authored into an existing linter (`legacy` tier), runtime-shaped candidates the agent did not author (`cloud` tier) each with `estimatedViolations`, the agent's estimate of how many instances of the candidate's pattern are in the code today, the agent's own redaction counts, and the fixtures it elects to withhold. The facts file SHALL NOT accept any value input: no token, call, price, time, or rate estimate. The CLI SHALL merge the facts with what it establishes itself, and SHALL treat its own values as authoritative for every field it can establish.

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

- **WHEN** the facts give any rule an `explain`, a legacy rule a `tool` or `language`, or a cloud candidate a `language` or `id`, containing an email address or a host name
- **THEN** the command SHALL exit non-zero with `REPORT_REDACTION` naming that field

#### Scenario: The agent's counts are carried

- **WHEN** the facts declare `person: 2` and the CLI matches no person names
- **THEN** `redaction.counts.person` SHALL be 2

### Requirement: The report recipe drives publishing and deletion

The CLI SHALL embed a `report` recipe following the canonical recipe template. It SHALL instruct the agent to: run `taskless report` and read `missing`; supply each missing fact from its session, writing the facts to `.taskless/.tmp-report.json`; give every rule an `explain` of one or two sentences saying what goes wrong without the rule and what holding it buys, grounded in what the session saw and carrying no counts; count each rule's `surfaced` by the method the recipe states; give each cloud candidate an `estimatedViolations` from what it saw while mining; run `taskless report --from` that path; on `REPORT_INSUFFICIENT`, ask the user only what would let it author the rules or establish the facts the refusal names, then retry; on success, show the CLI's summary as printed and tell the user the report can be deleted after review if they ask; delete the facts file; and on a request to delete, run `taskless report --delete` with the record. The recipe SHALL embed the facts schema and SHALL state that tskl.es does not redact, so anything the agent cannot vouch for is to be withheld.

The counting method SHALL be a single procedure: a pull request counts toward a rule's `surfaced.prs` when it merged inside the window and at least one review comment on it asked for the change the rule enforces; a comment counts toward `surfaced.reviewComments` when a reader of that comment would say it asks for that change. Only review comments count: the recipe SHALL state that a fix-up commit, a `git blame` date, or a finding in the code today is not a review comment and SHALL NOT be counted toward either field, since the facts have no field that would label it honestly. Every author counts: a comment from a bot account or from the pull request's own author SHALL count the same as a reviewer's, since each one spends cycles, tokens, time, or money. The recipe SHALL direct the agent to judge each comment by reading it, not by matching keywords.

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
- **THEN** the `## Counting surfaced` section SHALL state that a fix-up commit, a `git blame` date, and a finding in the code today are not review comments and do not count

#### Scenario: The recipe asks for an explanation of every rule

- **WHEN** an agent runs `taskless agent report`
- **THEN** stdout SHALL contain an `## Explaining a rule` section asking for one or two sentences on why each rule, written or candidate, is worth holding in this codebase
- **AND** that section SHALL tell the agent to leave counts out of `explain`

#### Scenario: The recipe asks for a candidate estimate and no value input

- **WHEN** an agent runs `taskless agent report`
- **THEN** the step that supplies facts SHALL direct the agent to give each cloud candidate an `estimatedViolations`
- **AND** SHALL NOT mention `contextTokens` or `callsPerCatch`
