## MODIFIED Requirements

### Requirement: Help subcommand displays rich help text for commands

The CLI SHALL support an `agent` subcommand that accepts at most one positional argument identifying a topic AND an optional `--anonymous` boolean flag. Topics SHALL be addressed by a single token; the subcommand SHALL NOT join multiple positionals into a topic key. When a topic is provided, the subcommand SHALL look up a matching help text file embedded at build time using the following resolution order:

1. If `--anonymous` is set AND `<topic>.anonymous.txt` exists in the embedded map, return that file.
2. Otherwise, return `<topic>.txt`.
3. If neither exists, exit with code 1 and an error message suggesting `taskless agent` for the topic index.

When no positional argument is provided, the subcommand SHALL print a topic index containing a one-paragraph human slug followed by a topic disambiguation table mapping topic names to their summaries.

The subcommand is named for its reader. It serves agents fetching a procedure, not humans asking for help, and single-token addressing exists so a topic name is a literal string an agent copies rather than a phrase it can reorder or paraphrase.

#### Scenario: Agent subcommand for a topic returns the recipe

- **WHEN** a user runs `taskless agent check`
- **THEN** the CLI SHALL print the contents of `check.txt` to stdout

#### Scenario: Multi-word topic paths are not resolved

- **WHEN** a user runs `taskless agent rule create`
- **THEN** the CLI SHALL NOT look up `rule-create.txt` by joining the positionals
- **AND** it SHALL exit non-zero rather than guessing a topic

#### Scenario: Formerly nested topics are addressed by one token

- **WHEN** a user runs `taskless agent improve-rule`
- **THEN** the CLI SHALL look up `improve-rule.txt` and print its contents

#### Scenario: The former command name is gone

- **WHEN** a user runs `taskless help check`
- **THEN** the CLI SHALL NOT print recipe text for `check`

### Requirement: onboard topic is registered in the help index

A help topic `onboard` SHALL be registered. The CLI SHALL embed `packages/cli/src/help/onboard.txt` at build time via the existing `import.meta.glob` mechanism. `taskless agent onboard` SHALL print the contents of `onboard.txt`. The topic SHALL appear in the output of `taskless agent` (the index) with a one-line summary describing it as the post-install rule-discovery flow.

#### Scenario: The onboard topic returns the recipe

- **WHEN** a user runs `taskless agent onboard`
- **THEN** the CLI SHALL print the contents of `onboard.txt` to stdout
- **AND** SHALL exit with code 0

#### Scenario: Topic index includes onboard

- **WHEN** a user runs `taskless agent` (no args)
- **THEN** the topic index SHALL include a row for `onboard`
- **AND** the row SHALL describe it as the post-install rule-discovery flow

### Requirement: help_onboard intent telemetry

Fetching the `onboard` topic SHALL emit the command's single intent event, `cli_help`, carrying `onboard` as its `topic` property.

Per-topic event names (`help_onboard` and siblings) are not emitted. One event with a topic property is filterable the same way and does not grow the event vocabulary every time a topic is added or renamed, which this change would otherwise have to do for every rename below.

#### Scenario: Fetching onboard captures its topic

- **WHEN** an agent runs `taskless agent onboard`
- **THEN** PostHog SHALL receive a `cli_help` event whose `topic` property is `onboard`

### Requirement: Routing topics are registered in the help system

The help system SHALL register `route` and each `create-*-rule` recipe as embedded topics, retrievable via `taskless agent <topic>` and listed in the topic index, consistent with the existing topic embedding and format requirements.

`existing`, `static`, and `remote` are no longer topics. `route` applies the criterion they carried and names a concrete destination, so an agent reaches an authoring recipe in one fetch.

#### Scenario: Routing topics resolve

- **WHEN** `taskless agent route` or any `taskless agent create-*-rule` is run
- **THEN** the corresponding recipe text SHALL be returned
- **AND** an unknown-topic error SHALL NOT be raised

#### Scenario: Removed routing topics do not resolve

- **WHEN** `taskless agent existing`, `taskless agent static`, or `taskless agent remote` is run
- **THEN** the CLI SHALL exit non-zero
- **AND** it SHALL NOT print recipe text

#### Scenario: Routing topics appear in the index

- **WHEN** `taskless agent` (no arguments) is run
- **THEN** the topic index SHALL include `route` and every `create-*-rule` topic

### Requirement: Routing topics emit intent telemetry

Fetching a routing recipe SHALL emit the command's single intent event, `cli_help`, carrying the served topic as its `topic` property.

#### Scenario: Intent is captured for routing recipes

- **WHEN** the agent fetches `route` or any `create-*-rule` topic
- **THEN** the command SHALL capture a `cli_help` event whose `topic` property is that topic name

### Requirement: Anonymous variant lookup uses a compile-time map

The help command SHALL construct, at build time, a Set of topic names that have a corresponding `<topic>.anonymous.txt` file. Lookup at runtime SHALL be O(1). The Set SHALL be derived from `import.meta.glob` matching `*.anonymous.txt` in the help directory.

#### Scenario: Topics with variants are detected at build time

- **WHEN** the CLI bundle is built
- **AND** a file `improve-rule.anonymous.txt` exists
- **THEN** the embedded variants set SHALL contain `improve-rule`

#### Scenario: Topics without variants are absent from the map

- **WHEN** the CLI bundle is built
- **AND** no `check.anonymous.txt` file exists
- **THEN** the embedded variants set SHALL NOT contain `check`
- **AND** `taskless agent check --anonymous` SHALL fall back to `check.txt`

### Requirement: Embedded JSON schemas are generated via zod-to-json-schema

For every recipe topic that documents a CLI command accepting `--from <file>`, the corresponding Zod input schema in `packages/cli/src/schemas/` SHALL be converted to JSON Schema and embedded in the recipe's `## Input schema` section as a fenced code block. Generation MAY happen at runtime (small dep, fast) or at build time; runtime is acceptable.

#### Scenario: The remote authoring recipe embeds its input schema

- **WHEN** a user runs `taskless agent create-remote-rule`
- **THEN** the output SHALL contain an `## Input schema` section
- **AND** the section SHALL contain a code-fenced JSON Schema block derived from the `rules-create` Zod schema

#### Scenario: The improve recipe embeds its input schema

- **WHEN** a user runs `taskless agent improve-rule`
- **THEN** the output SHALL contain an `## Input schema` section with the rule-improve JSON Schema

### Requirement: Help command emits intent telemetry

The `agent` command SHALL emit one PostHog event, `cli_help`, on every invocation, carrying a `topic` property:

- the served topic when a positional resolves to a known topic
- the attempted topic string when it resolves to none
- `(index)` when called with no positional arguments
- the joined positionals when more than one is supplied

#### Scenario: Topic fetch captures the topic

- **WHEN** an agent runs `taskless agent create-sg-rule`
- **THEN** PostHog SHALL receive a `cli_help` event whose `topic` property is `create-sg-rule`

#### Scenario: Index fetch captures the index

- **WHEN** an agent runs `taskless agent` (no args)
- **THEN** PostHog SHALL receive a `cli_help` event whose `topic` property is `(index)`

## ADDED Requirements

### Requirement: Routing recipes name a destination, not a second decision

The `route` recipe SHALL apply the engine reasoning directly and name a concrete `create-*-rule` topic, rather than referring the reader onward to a topic that selects an engine. No shipped recipe SHALL refer to `engine-selection`, which no longer exists.

Each `create-*-rule` recipe SHALL instead point back at `route` for a reader who arrived at the wrong one, so recovery costs a re-decision rather than a second copy of the criterion (see "Every authoring recipe opens by orienting the reader").

#### Scenario: Route names a destination without a second fetch

- **WHEN** an agent follows `route`
- **THEN** the recipe SHALL name one `create-*-rule` topic
- **AND** it SHALL NOT require fetching a separate engine-selection topic first to do so

#### Scenario: Authoring recipes point back rather than re-deciding

- **WHEN** an agent reads any `create-*-rule` recipe
- **THEN** the recipe SHALL name `route` as where to go if this is the wrong destination
- **AND** it SHALL NOT reference `engine-selection`

### Requirement: Shipped recipes name only commands that exist

No embedded recipe SHALL contain the string `taskless help`. Recipes cross-reference each other by literal command string, so a stale reference is invisible until an agent runs it and receives nothing.

#### Scenario: No recipe references the removed command

- **WHEN** the embedded recipe set is inspected
- **THEN** no recipe SHALL contain `taskless help`

## REMOVED Requirements

### Requirement: The engine-selection topic is registered in the help system

**Reason**: The topic no longer exists. Its criterion moved into `route`, which now applies the engine reasoning itself and names a concrete destination, so there is nothing left to register or to fetch.

### Requirement: Routing recipes reference engine selection

**Reason**: Replaced by "Routing recipes name a destination, not a second decision". The requirement named `route` and `static` and obliged them to forward to a separate engine-selection topic; `static` is gone, and forwarding is the behavior this change removes.
