## MODIFIED Requirements

### Requirement: Onboard recipe follows the canonical recipe template and is conversational

The `onboard.md` file SHALL follow the canonical recipe template defined in the `cli-agent` capability (header with CLI version + topic version, `## Goal`, `## Preconditions`, `## Steps`, `## Errors`, `## See Also`). The `## Steps` section SHALL describe a conversational discovery flow rather than a fixed sequence. Specifically, the recipe SHALL instruct the agent to:

1. Read `.taskless/taskless.json` and respect the `install.onboarded` field.
2. Establish the routing surface before proposing any candidate, by fetching the `route` topic for the destination criterion and running `taskless detect --json` for the repository's linters, languages, and rule styles.
3. Open the conversation with a short menu of known sources for rule candidates: codebase TODOs/FIXMEs (via ripgrep or built-in search), agent-memory files (CLAUDE.md, AGENTS.md, .cursorrules, etc.), recent PR review comments, and bug-tracker tickets.
4. Encourage the user to suggest additional sources the agent may not know about.
5. Report the command-line tools the CLI already found, rather than instruct the agent to probe for them. The recipe SHALL NOT instruct the agent to run `command -v` or any equivalent probe for a tool the CLI reports on.
6. For each chosen source, scan and filter for high-signal candidates: repeated patterns across multiple PRs/files/comments, comments that cite a doc or style guide, and merge-blocking review feedback. Filter out one-off nits and pure formatting feedback.
7. Synthesize a single bullet list where each bullet is a hypothetical rule expressed as `<kebab-case-name> [<destination>]: <one-line description of what it would enforce>`.
8. For each bullet, offer to materialize it by following the `route` topic, with the accepted bullet as the rule description input.
9. Once the user has materialized what they want, decide with the user when the rules run. The recipe SHALL instruct the agent to report the CI systems and commit-hook tools `taskless detect --json` found, to offer wiring `check` into CI by following the `ci` topic and into a pre-commit hook by following the `hooks` topic, and to carry out whichever the user picks. Declining both SHALL be an accepted answer, and the agent SHALL say in one line that `check` then runs only when someone invokes it.
10. Only after that, ask the user whether they consider onboarding complete; on explicit yes, run `taskless onboard --mark-complete`.

The recipe SHALL describe a detected tool as present, never as verified. The CLI establishes presence by looking for a file on `PATH` and executes nothing, so the recipe SHALL say so — "`gh` is on your PATH; Taskless did not run it" — and SHALL NOT assert that a tool works, is a particular version, or is genuine.

The recipe SHALL NOT name one bug tracker as the expected one. It MAY name trackers such as Jira and Linear as examples of the class. Whether a tracker is reachable depends on the agent's MCP roster, which the CLI cannot see, so the recipe SHALL leave that judgement to the agent at runtime and SHALL condition the source on a relevant MCP being available rather than on any named vendor.

When a source is not offered, the recipe SHALL say in one line why it is not offered. A reader who is not told reads the omission as an oversight and asks for it, which costs a turn and ends where the recipe already is. Where a source is unavailable for more than one reason, the reason that cannot be remedied SHALL be the one stated: a repository with no GitHub `origin` SHALL be told there are no pull requests to mine, not that `gh` is missing, and SHALL NOT be offered PR-comment mining even when `gh` is present.

The recipe SHALL NOT restate the destination criterion itself. That comparison is defined once, in the `route` topic, and the recipe SHALL reference it rather than duplicate it.

The recipe SHALL warn the agent against marking onboarding complete without explicit user confirmation.

The recipe SHALL require the mark-complete question to be asked in a message that asks nothing else. A reply to a message carrying two questions cannot be read as explicit consent to either, and `--mark-complete` is consent-gated, so the recipe SHALL NOT let the question share a message with the step that decides when the rules run.

#### Scenario: Recipe header includes CLI and topic version

- **WHEN** `onboard.md` is read
- **THEN** the first line SHALL match the canonical header format `# Topic: onboard     (CLI v<x.y.z> / topic v<n>)`

#### Scenario: Recipe establishes the routing surface before proposing candidates

- **WHEN** the recipe `## Steps` section is read
- **THEN** a step instructing the agent to fetch the `route` topic and to run `detect --json` SHALL appear before the step that synthesizes the bullet list

#### Scenario: Recipe does not duplicate the destination criterion

- **WHEN** `onboard.md` is read
- **THEN** it SHALL NOT contain a table or enumeration comparing the rule destinations against one another
- **AND** it SHALL direct the agent to the `route` topic for that comparison

#### Scenario: Recipe enumerates the known source menu

- **WHEN** the recipe `## Steps` section is read with no host-tool state supplied
- **THEN** it SHALL list at least: codebase TODOs/FIXMEs, agent-memory files, PR review comments, and bug-tracker tickets
- **AND** it SHALL NOT instruct the agent to probe for `gh`

#### Scenario: A present and applicable tool is offered as present

- **WHEN** the recipe is rendered for a GitHub repository on a host where `gh` is on `PATH`
- **THEN** the PR-review source SHALL be offered
- **AND** the text SHALL state that `gh` is on the PATH and that Taskless did not run it

#### Scenario: An absent tool is omitted with its reason

- **WHEN** the recipe is rendered for a GitHub repository on a host where `gh` is not on `PATH`
- **THEN** the PR-review source SHALL NOT be offered
- **AND** the recipe SHALL state in one line that `gh` was not found on the PATH

#### Scenario: A repository with no GitHub origin is told the source does not apply

- **WHEN** the recipe is rendered for a repository whose `ghOwner` resolves to `[unknown]`, whether or not `gh` is on `PATH`
- **THEN** the PR-review source SHALL NOT be offered
- **AND** the stated reason SHALL be that the repository has no GitHub origin, not that `gh` is missing

#### Scenario: Recipe encourages user-suggested sources

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL explicitly instruct the agent to ask the user whether other sources should be scanned

#### Scenario: Recipe specifies the annotated bullet output shape

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL describe the rule-candidate output as a bullet list with `<kebab-case-name> [<destination>]: <description>` per item
- **AND** SHALL state that the annotation is provisional and that the `route` topic decides the destination at materialization time

#### Scenario: Recipe gates --mark-complete on user confirmation

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL instruct the agent to ask for explicit user confirmation before invoking `taskless onboard --mark-complete`
- **AND** SHALL warn that the agent must NOT mark onboarding complete without that confirmation

#### Scenario: Recipe references the rule-authoring route topic in See Also

- **WHEN** the `## See Also` section is read
- **THEN** it SHALL include a reference to `taskless agent route`

#### Scenario: Recipe decides when the rules run before asking to mark complete

- **WHEN** the recipe `## Steps` section is read
- **THEN** a step that offers wiring `check` into CI via the `ci` topic and into a pre-commit hook via the `hooks` topic SHALL appear after the materialization step
- **AND** it SHALL appear before the step that asks about `--mark-complete`
- **AND** it SHALL direct the agent to the `ci` and `hooks` fields of `detect --json` for what the repository already has

#### Scenario: Declining both is an accepted answer

- **WHEN** the recipe's step that decides when the rules run is read
- **THEN** it SHALL accept a user who wants neither CI nor a hook
- **AND** SHALL instruct the agent to state that `check` then runs only when someone invokes it

#### Scenario: The mark-complete question is asked alone

- **WHEN** the recipe step that asks about `--mark-complete` is read
- **THEN** it SHALL instruct the agent to ask that question in a message containing no other question

#### Scenario: Recipe references the ci and hooks topics in See Also

- **WHEN** the `## See Also` section is read
- **THEN** it SHALL include a reference to `taskless agent ci`
- **AND** it SHALL include a reference to `taskless agent hooks`
