## ADDED Requirements

### Requirement: ok topic confirms the CLI can run

`taskless agent ok` SHALL print exactly one line, `This message confirms you can run Taskless via <invocation>.`, and exit 0. `<invocation>` SHALL be the invocation detected for this process. When the launcher cannot be determined, the line SHALL read `This message confirms you can run Taskless via the command you just ran.` rather than guessing a launcher.

The topic is built into the `agent` command, not a recipe file. It SHALL NOT carry the `# Topic:` header, the fetch-time directive, or a survey invite, and it SHALL NOT read or create `.taskless/`. It SHALL emit the command's `cli_agent` intent event with `topic: "ok"`. The topic SHALL appear in the `taskless agent` index.

#### Scenario: ok prints one confirmation line

- **WHEN** `taskless agent ok` is run
- **THEN** stdout SHALL be a single line beginning `This message confirms you can run Taskless via`
- **AND** the CLI SHALL exit with code 0

#### Scenario: ok names the detected invocation

- **WHEN** `taskless agent ok` is run by a launcher the CLI detects
- **THEN** the line SHALL name that launcher and the pinned package specifier

#### Scenario: ok does not guess an unknown launcher

- **WHEN** `taskless agent ok` is run and the launcher cannot be determined
- **THEN** the line SHALL say `via the command you just ran` and SHALL NOT name a launcher

#### Scenario: ok runs outside a Taskless project

- **WHEN** `taskless agent ok` is run in a directory with no `.taskless/`
- **THEN** it SHALL print the confirmation line and exit 0
- **AND** SHALL NOT create `.taskless/`

#### Scenario: ok is in the index

- **WHEN** `taskless agent` is run with no arguments
- **THEN** the index SHALL include a row for `ok`

#### Scenario: ok captures its topic

- **WHEN** `taskless agent ok` is run
- **THEN** PostHog SHALL receive a `cli_agent` event whose `topic` property is `ok`
