## ADDED Requirements

### Requirement: report topic is registered in the agent index

An agent topic `report` SHALL be registered. The CLI SHALL embed `packages/cli/src/agent/report.md` at build time through the same mechanism as every other topic. `taskless agent report` SHALL print the rendered recipe, and the topic SHALL appear in the output of `taskless agent` with a one-line summary describing it as publishing or regenerating a Taskless report. Fetching it SHALL emit `cli_agent` with `report` as its `topic` property.

#### Scenario: The report topic returns the recipe

- **WHEN** a user runs `taskless agent report`
- **THEN** the CLI SHALL print the `report` recipe and exit 0

#### Scenario: Topic index includes report

- **WHEN** a user runs `taskless agent` with no arguments
- **THEN** the topic index SHALL include a row for `report`

#### Scenario: Fetching report captures its topic

- **WHEN** an agent runs `taskless agent report`
- **THEN** PostHog SHALL receive a `cli_agent` event whose `topic` property is `report`
