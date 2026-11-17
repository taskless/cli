## MODIFIED Requirements

### Requirement: Onboard recipe follows the canonical recipe template and asks one question

The `onboard.md` file SHALL follow the canonical recipe template defined in the `cli-agent` capability (header with CLI version + topic version, `## Goal`, `## Preconditions`, `## Steps`, `## Errors`, `## See Also`). The spec SHALL NOT pin the topic version: it changes with every revision of the recipe, and the recipe header is where it is recorded.

The recipe SHALL instruct the agent to:

1. Read `.taskless/taskless.json` and respect the `install.onboarded` field.
2. Ask the user exactly one question, "Do you want me to set up Taskless for you?", preceded by a scripted introduction the agent SHALL repeat word for word and SHALL NOT reword or extend, set apart from surrounding text by blank lines, and through the host's structured question tool when the host has one. The introduction SHALL name the sources in general terms (the repository, agent files, documentation, PRs, bug tracking), state that rules are written locally with no login, and state that a report is generated. The recipe SHALL state that a yes covers mining the repository, writing rules, publishing the report, and sending onboarding feedback. On anything but a yes the agent SHALL stop.
3. Establish the routing surface before proposing any candidate, by fetching the `route` topic for the destination criterion and running `taskless detect --json` for the repository's linters, languages, rule styles, host tools, and `agent` hints.
4. Mine every reachable source without asking which: codebase TODOs/FIXMEs, agent-memory files (CLAUDE.md, AGENTS.md, .cursorrules, and similar), review comments through whichever host tool `detect` reports present and applicable (pull requests through `gh`, merge requests through `glab`), the commit history of the window being mined, read for fixes that recur, and any MCP the agent has that reaches a bug tracker, an engineering-context tool, or architectural decisions. Whether to run a hinted command such as `gh auth status`, and which MCPs to use, SHALL be left to the agent. Wherever the review-comment source is offered, the recipe SHALL direct the agent to cover the whole window rather than the most recent pull or merge requests, SHALL give commands that rely on the host CLI's own pagination so the agent writes no pagination loop of its own, and, when the window holds more than the agent can fetch review bodies for, SHALL direct it to sample evenly across the whole window and to report counts from a sample as a floor. For GitHub it SHALL name the 1000-result cap of `gh pr list` and `gh search`, give a command that counts the window's merged pull requests and one that lists them by date range, and give the repository-wide review-comments endpoint filtered by `since` for the window's inline comments.
5. Filter for high-signal candidates: repeated patterns across multiple PRs/files/comments, comments that cite a doc or style guide, and merge-blocking review feedback; drop one-off nits and pure formatting feedback. The recipe SHALL state that a rule's `surfaced` counts review comments alone, and that every other source the agent mines is credited as that kind's evidence for the report instead: commits that made the fix as `commits`, tracker and engineering-context items as `issues`, TODO/FIXME-style comments as `conventions`, agent-memory files as `agent-files`, documentation as `docs`, and tests as `tests`. The recipe SHALL direct the agent to record, while mining, each counted pull request and comment and each call-out from every other source under its candidate, with its kind, scoped to the rule it expects to write, so `surfaced`, `sources`, and `evidence` all come from that record rather than a second read. The recipe SHALL direct the agent to keep only kinds and counts for the report, never paths, file names, commits, or issue titles.
6. Author every candidate the routing surface sends to a local destination (`legacy`, `sg`, or `vale`) by following the `route` topic, without asking per candidate.
7. Record, and not author, every candidate the agent judges better solved by a runtime rule, for the report's `cloud` tier, noting how many instances of its pattern the agent saw in the code, which the report takes as that candidate's estimate.
8. Once the rules are written, run `taskless onboard --mark-complete` without asking.
9. Hand off to the `report` topic to publish the report, and, in parallel, send onboarding feedback by following the `rule-feedback` topic as the respondent.
10. Close by showing the report summary, then, as the last thing the agent does, offer to wire `taskless check` into the repository's CI by following the `ci` topic, and strongly encourage it: Taskless checks in CI are what keep agents from reintroducing the patterns these rules catch. The offer SHALL name the CI systems `detect --json` found. On a yes the agent SHALL follow the `ci` topic; on a no it SHALL name the `hooks` topic in one line as the local alternative. Either way, the agent's final message SHALL end with the report link on its own line, as a plain URL or a Markdown link and not inside a code block, and the agent SHALL then stop. The link SHALL be the one the report summary showed, never the contents of the record in `.taskless/reports/`.

The recipe SHALL operate logged out throughout. It SHALL NOT direct the agent to `auth login`, and SHALL NOT author a runtime rule.

Beyond the opening question and the closing CI offer, the recipe SHALL permit a question only when the agent is unsure what rules to write AND the `report` topic's gate has refused for too few Taskless rules. It SHALL limit such a question to what would let the agent write the missing rules.

The recipe SHALL describe a detected tool as present, never as verified, and SHALL NOT instruct the agent to run `command -v` or any equivalent probe for a tool `detect` reports on.

The recipe SHALL NOT name one bug tracker as the expected one. It MAY name trackers such as Jira and Linear as examples of the class.

When a review-comment source is unavailable, the recipe SHALL say in one line why, stating the reason that cannot be remedied first: a repository whose `origin` is on neither GitHub nor GitLab SHALL be told there are no pull or merge requests to mine, not that a CLI is missing.

The recipe SHALL NOT restate the destination criterion itself; it SHALL reference the `route` topic.

#### Scenario: Recipe header includes CLI and topic version

- **WHEN** `onboard.md` is read
- **THEN** the first line SHALL match the canonical header format `# Topic: onboard     (CLI v<x.y.z> / topic v<n>)`

#### Scenario: The opening question is the only scripted question

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL contain the question "Do you want me to set up Taskless for you?"
- **AND** SHALL precede it with the scripted introduction, and direct the agent not to reword or extend it
- **AND** SHALL direct the agent to use the host's structured question tool when one exists
- **AND** no other step SHALL direct the agent to ask the user a question, except the step handling a refused report gate and the closing CI offer

#### Scenario: Recipe establishes the routing surface before proposing candidates

- **WHEN** the recipe `## Steps` section is read
- **THEN** a step instructing the agent to fetch the `route` topic and to run `detect --json` SHALL appear before the step that authors rules

#### Scenario: Recipe does not duplicate the destination criterion

- **WHEN** `onboard.md` is read
- **THEN** it SHALL NOT contain a table or enumeration comparing the rule destinations against one another
- **AND** it SHALL direct the agent to the `route` topic for that comparison

#### Scenario: Sources are mined without a menu

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL name codebase TODOs/FIXMEs, agent-memory files, review comments, commit history, and MCP-reachable trackers and engineering context as sources
- **AND** SHALL NOT direct the agent to ask the user which sources to include

#### Scenario: A busy review window is covered without hand-written pagination

- **WHEN** the recipe is rendered for a GitHub repository on a host where `gh` is on `PATH`, or with `gh` unmeasured
- **THEN** the review-comment source SHALL state that `gh pr list` and `gh search` stop at 1000 results
- **AND** SHALL give a command counting the window's merged pull requests, a command listing them by date range, and a `gh api --paginate` command for the repository's review comments `since` the window's first day
- **AND** SHALL direct the agent to write no pagination loop of its own
- **AND** SHALL direct any sample to span the whole window, never the most recent pull requests, and state that counts from a sample are a floor

#### Scenario: Surfaced is counted while mining

- **WHEN** the recipe's scan step is read
- **THEN** it SHALL direct the agent to record each counted pull request and comment under its candidate as it mines, at the scope of the rule it expects to write

#### Scenario: Every source is tallied while mining

- **WHEN** the recipe's scan step is read
- **THEN** it SHALL direct the agent to record each call-out from commits, trackers, code comments, agent-memory files, documentation, and tests under its candidate, with its kind, as it mines
- **AND** SHALL direct the agent to keep kinds and counts, never paths or titles

#### Scenario: A present and applicable tool is offered as present

- **WHEN** the recipe is rendered for a GitHub repository on a host where `gh` is on `PATH`
- **THEN** the review-comment source SHALL be included
- **AND** the text SHALL state that `gh` is on the PATH and that Taskless did not run it

#### Scenario: An absent tool is omitted with its reason

- **WHEN** the recipe is rendered for a GitHub repository on a host where `gh` is not on `PATH`
- **THEN** the review-comment source SHALL NOT be included
- **AND** the recipe SHALL state in one line that `gh` was not found on the PATH

#### Scenario: A repository on neither host is told the source does not apply

- **WHEN** the recipe is rendered for a repository whose `origin` is on neither GitHub nor GitLab, whatever tools are on `PATH`
- **THEN** the review-comment source SHALL NOT be included
- **AND** the stated reason SHALL be that there are no pull or merge requests to mine

#### Scenario: Onboarding stays logged out

- **WHEN** `onboard.md` is read
- **THEN** it SHALL NOT direct the agent to `auth login`
- **AND** SHALL direct runtime-shaped candidates to the report's `cloud` tier rather than to authoring
- **AND** SHALL direct the agent to note how many instances of each such candidate's pattern it saw, for the report's estimate

#### Scenario: Onboarding completes without a confirmation question

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL direct the agent to run `taskless onboard --mark-complete` once the rules are written
- **AND** SHALL NOT direct the agent to ask before doing so

#### Scenario: Onboarding hands off to the report and sends feedback

- **WHEN** the recipe `## Steps` section is read
- **THEN** a step after mark-complete SHALL direct the agent to the `report` topic
- **AND** SHALL direct it to follow the `rule-feedback` topic as the respondent

#### Scenario: CI is offered last and strongly encouraged

- **WHEN** the recipe's closing step is read
- **THEN** it SHALL appear after the report summary is shown and be the last step
- **AND** it SHALL direct the agent to offer wiring `check` into CI via the `ci` topic, naming the CI systems `detect --json` found
- **AND** it SHALL direct the agent to strongly encourage a yes, stating that checks in CI keep agents from reintroducing what the rules catch

#### Scenario: Declining CI points at hooks

- **WHEN** the user declines the CI offer
- **THEN** the recipe SHALL direct the agent to name the `hooks` topic in one line, end with the report link, and stop

#### Scenario: The final message ends with the report link

- **WHEN** the recipe's closing step is read
- **THEN** it SHALL direct the agent to end its final message with the report link on its own line, whether the user accepted or declined CI
- **AND** SHALL direct that the link be a plain URL or a Markdown link, not inside a code block
- **AND** SHALL direct the agent not to print the record in `.taskless/reports/`, which holds the delete URL

#### Scenario: Recipe references its neighbors in See Also

- **WHEN** the `## See Also` section is read
- **THEN** it SHALL include references to `taskless agent route`, `taskless agent report`, `taskless agent rule-feedback`, `taskless agent ci`, and `taskless agent hooks`

#### Scenario: Commit history is mined for recurring fixes

- **WHEN** the recipe is rendered, in any host-tool state
- **THEN** the sources SHALL include the commit history of the window, read for fixes that recur
- **AND** the recipe SHALL state that such fixes can be the only signal in a repository reviewed before its pull requests open, or written mostly by agents

#### Scenario: Commit evidence does not count as surfaced

- **WHEN** the recipe's scan step is read
- **THEN** it SHALL state that commits that made a rule's fix count as `commits` evidence and never toward `surfaced`
