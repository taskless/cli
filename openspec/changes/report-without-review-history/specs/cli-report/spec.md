## MODIFIED Requirements

### Requirement: The report recipe drives the flow

The CLI SHALL embed a `report` recipe following the canonical recipe template. It SHALL instruct the agent to: run `taskless report` and read `missing`; supply each missing fact from its session, writing the facts to `.taskless/.tmp-report.json`; count each rule's `surfaced` by the method the recipe states; estimate context tokens and calls per catch from how this user's sessions actually run; run `taskless report --from` that path; on `REPORT_INSUFFICIENT`, ask the user only what would let it author the rules or establish the facts the refusal names, then retry; on success, show the CLI's summary as printed and tell the user the report can be deleted after review if they ask; delete the facts file; and on a request to delete, run `taskless report --delete` with the record. The recipe SHALL embed the facts schema and SHALL state that tskl.es does not redact, so anything the agent cannot vouch for is to be withheld.

The counting method SHALL be a single procedure: a pull request counts toward a rule's `surfaced.prs` when it merged inside the window and at least one review comment on it asked for the change the rule enforces; a comment counts toward `surfaced.reviewComments` when a reader of that comment would say it asks for that change. Only review comments count: the recipe SHALL state that a fix-up commit, a `git blame` date, or a finding in the code today is not a review comment and SHALL NOT be counted toward either field, since the facts have no field that would label it honestly. Every author counts: a comment from a bot account or from the pull request's own author SHALL count the same as a reviewer's, since each one spends cycles, tokens, time, or money. The recipe SHALL direct the agent to judge each comment by reading it, not by matching keywords.

Whenever the agent restates the report's numbers in its own words, the recipe SHALL require it to keep counts the CLI measured in the code today apart from counts mined from review history over the window, and to say which is which.

When every rule, legacy rule, and cloud candidate carries zero `surfaced` counts, the recipe SHALL direct the agent, after showing the summary, to tell the user in one line that the page's estimate is $0 because review over the window raised none of these patterns, not because the rules catch nothing, and that the findings in the code today are what the rules catch.

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

#### Scenario: An all-zero estimate is explained

- **WHEN** an agent runs `taskless agent report`
- **THEN** the step that shows the summary SHALL direct the agent, when every `surfaced` count is zero, to say the $0 estimate reflects review history that raised none of the patterns, not rules that catch nothing
- **AND** SHALL point to the findings in the code today
