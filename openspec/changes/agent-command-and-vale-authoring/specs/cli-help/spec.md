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

- **WHEN** a user runs `taskless agent create-rule`
- **THEN** the CLI SHALL look up `create-rule.txt` and print its contents

#### Scenario: The former command name is gone

- **WHEN** a user runs `taskless help check`
- **THEN** the CLI SHALL NOT print recipe text for `check`

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

## ADDED Requirements

### Requirement: Shipped recipes name only commands that exist

No embedded recipe SHALL contain the string `taskless help`. Recipes cross-reference each other by literal command string, so a stale reference is invisible until an agent runs it and receives nothing.

#### Scenario: No recipe references the removed command

- **WHEN** the embedded recipe set is inspected
- **THEN** no recipe SHALL contain `taskless help`
