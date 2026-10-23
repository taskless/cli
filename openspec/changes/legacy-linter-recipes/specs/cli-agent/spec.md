## MODIFIED Requirements

### Requirement: Agent subcommand serves recipes for commands

The CLI SHALL support an `agent` subcommand that accepts at most one positional argument identifying a topic, an optional `--anonymous` boolean flag, AND an optional `--tool <name>` value flag. Topics SHALL be addressed by a single token; the subcommand SHALL NOT join multiple positionals into a topic key. When a topic is provided, the subcommand SHALL look up a matching recipe file embedded at build time using the following resolution order:

1. If `--tool` is set AND `<topic>.<tool>.md` exists in the embedded map, return that file.
2. If `--anonymous` is set AND `<topic>.anonymous.md` exists in the embedded map, return that file.
3. Otherwise, return `<topic>.md`.
4. If none of these exists, exit with code 1 and an error message suggesting `taskless agent` for the topic index.

`--tool` SHALL refuse, with a non-zero exit and a message naming the recipe to use instead, a tool that has its own authoring recipe (`ast-grep`, `vale`) or that cannot hold a rule (`prettier`, `black`). An unrecognized tool name SHALL fall back to `<topic>.md`.

When no positional argument is provided, the subcommand SHALL print a topic index containing a one-paragraph human slug followed by a topic disambiguation table mapping topic names to their summaries.

The subcommand is named for its reader. It serves agents fetching a procedure, not humans asking for help, and single-token addressing exists so a topic name is a literal string an agent copies rather than a phrase it can reorder or paraphrase.

#### Scenario: Agent subcommand for a topic returns the recipe

- **WHEN** a user runs `taskless agent check`
- **THEN** the CLI SHALL print the contents of `check.md` to stdout

#### Scenario: Multi-word topic paths are not resolved

- **WHEN** a user runs `taskless agent rule create`
- **THEN** the CLI SHALL NOT look up `rule-create.md` by joining the positionals
- **AND** it SHALL exit non-zero rather than guessing a topic

#### Scenario: Formerly nested topics are addressed by one token

- **WHEN** a user runs `taskless agent improve-rule`
- **THEN** the CLI SHALL look up `improve-rule.md` and print its contents

#### Scenario: The former command name is gone

- **WHEN** a user runs `taskless help check`
- **THEN** the CLI SHALL NOT print recipe text for `check`

#### Scenario: A tool variant is served

- **WHEN** a user runs `taskless agent create-legacy-rule --tool=ruff`
- **AND** `create-legacy-rule.ruff.md` exists
- **THEN** the CLI SHALL print that file's contents

#### Scenario: An unknown tool falls back to the generic recipe

- **WHEN** a user runs `taskless agent create-legacy-rule --tool=rubocop`
- **AND** no `create-legacy-rule.rubocop.md` exists
- **THEN** the CLI SHALL print `create-legacy-rule.md`

#### Scenario: A tool with its own recipe is refused

- **WHEN** a user runs `taskless agent create-legacy-rule --tool=vale`
- **THEN** the CLI SHALL exit non-zero and name `create-vale-rule` as the recipe to use
