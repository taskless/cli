## ADDED Requirements

### Requirement: Route applies the legacy ladder in order

For a request in a repository where `detect --json` reports a linter, the `route` recipe SHALL apply these steps in order and stop at the first that solves the request:

1. A rule the detected linter already ships, including its catch-all rules, solves it.
2. The repository has five or more of its own custom rules for that linter, and a new one modeled on them is maintainable.
3. A Taskless static rule.
4. A Taskless runtime rule.

Step 1 SHALL be taken whenever a detected linter could host the rule, regardless of how much custom configuration the repository has. Step 2 SHALL NOT be taken below the five-rule threshold.

#### Scenario: A shipped rule wins over a Taskless rule

- **WHEN** a detected linter ships a rule that solves the request
- **THEN** `route` SHALL name `create-legacy-rule` for that linter

#### Scenario: No shipped rule and no examples falls to Taskless

- **WHEN** no shipped rule solves the request AND the repository has fewer than five custom rules for any linter that could host it
- **THEN** `route` SHALL continue to a Taskless destination

### Requirement: Route describes each detected linter

The `route` recipe SHALL include, for each linter `detect` reports that can host a legacy rule, one paragraph saying what the tool is for, what the agent always checks first in it, and the recipe command to fetch for it. The paragraphs SHALL be rendered when the recipe is served, and SHALL appear only for linters detected in the repository.

#### Scenario: Only detected linters are described

- **WHEN** `detect` reports Ruff and no other linter
- **THEN** the served `route` recipe SHALL contain the Ruff paragraph
- **AND** SHALL NOT contain a paragraph for any other linter

#### Scenario: A tool with no legacy recipe gets no paragraph

- **WHEN** `detect` reports only `prettier`
- **THEN** the served `route` recipe SHALL contain no linter paragraph

### Requirement: Route asks the user only when the ladder does not decide

The `route` recipe SHALL present the viable options to the user with their
trade-offs, rather than silently selecting one, whenever more than one destination
genuinely fits a request. The order of the legacy ladder SHALL decide between a
legacy rule and a Taskless rule, so that pair SHALL NOT be posed as a choice. The
trade-off framing SHALL note that `remote` consumes a generation and requires
login, so it is appropriate when a request cannot be solved locally rather than as
a default.

#### Scenario: A legacy rule and a static rule are not posed as a choice

- **WHEN** the repository has a detected linter that ships a rule solving the
  request AND the pattern is also a clean local static ast-grep rule
- **THEN** `route` SHALL name the legacy destination without asking the user to
  choose between it and `create-sg-rule`

#### Scenario: Trade-off framing names the generation cost of remote

- **WHEN** `route` presents options that include `remote`
- **THEN** it SHALL state that `remote` consumes a generation and requires login
- **AND** SHALL frame `remote` as the path for what cannot be solved locally

## MODIFIED Requirements

### Requirement: Existing recipe authors in the detected linter's dialect

The CLI SHALL provide a `create-legacy-rule` help recipe that instructs the agent to solve a request with a linter already detected in the repository, in that tool's own dialect. The recipe SHALL direct the agent to look first for a rule the tool already ships, and to write a new custom rule only from the repository's own existing rules for that linter. The recipe MAY carry a short, curated, linked list of rule sources, such as a tool's catch-all rules or a set of well-known plugins. It SHALL NOT embed a catalog of individual linter rules.

The recipe is named for the artifact it produces. "Existing" described the repository's state rather than the rule being written, which is not something an agent can address by name.

#### Scenario: Repo-first knowledge sourcing

- **WHEN** the agent follows `create-legacy-rule` to write a new custom rule
- **THEN** it SHALL read the repository's own rules for that linter before consulting any external source

#### Scenario: A shipped rule is looked for first

- **WHEN** the agent follows `create-legacy-rule`
- **THEN** it SHALL establish whether a rule the tool already ships solves the request before writing anything new

## REMOVED Requirements

### Requirement: Route asks the user when multiple paths fit

**Reason**: It required `route` to pose a legacy rule and a Taskless static rule as a choice whenever both fit. The legacy ladder now decides that pair by order, and onboarding, which follows `route`, is not allowed to ask per candidate.

**Migration**: Replaced by "Route asks the user only when the ladder does not decide", which keeps the remote trade-off framing and asks only where more than one destination fits after the ladder is applied.
