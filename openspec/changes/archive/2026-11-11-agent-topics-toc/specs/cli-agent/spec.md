## MODIFIED Requirements

### Requirement: Agent subcommand serves recipes for commands

The CLI SHALL support an `agent` subcommand that accepts at most one positional argument identifying a topic, an optional `--anonymous` boolean flag, an optional `--tool <name>` value flag, an optional `--section <name>` value flag, AND an optional `--full` boolean flag. Topics SHALL be addressed by a single token; the subcommand SHALL NOT join multiple positionals into a topic key. When a topic is provided, the subcommand SHALL look up a matching recipe file embedded at build time using the following resolution order:

1. If `--tool` is set AND `<topic>.<tool>.md` exists in the embedded map, return that file.
2. If `--anonymous` is set AND `<topic>.anonymous.md` exists in the embedded map, return that file.
3. Otherwise, return `<topic>.md`.
4. If none of these exists, exit with code 1 and an error message suggesting `taskless agent` for the topic index.

On a topic that has tool variants, `--tool` SHALL refuse, with a non-zero exit and a message naming the recipe to use instead, a tool that has its own authoring recipe (`ast-grep`, `vale`) or that cannot hold a rule (`prettier`, `black`). An unrecognized tool name SHALL fall back to `<topic>.md`.

Which part of the resolved recipe is printed is governed by the requirement "Long topics are served as an outline with sections on request": by default its outline, with `--section` one section, with `--full` all of it. A second positional SHALL NOT be read as a section name; the error for it SHALL name `--section <name>`.

When no positional argument is provided, the subcommand SHALL print a topic index containing a one-paragraph human slug followed by a topic disambiguation table mapping topic names to their summaries.

The subcommand is named for its reader. It serves agents fetching a procedure, not humans asking for help, and single-token addressing exists so a topic name is a literal string an agent copies rather than a phrase it can reorder or paraphrase.

#### Scenario: Agent subcommand for a topic returns the recipe

- **WHEN** a user runs `taskless agent check`
- **THEN** the CLI SHALL print the outline of `check.md` to stdout

#### Scenario: Multi-word topic paths are not resolved

- **WHEN** a user runs `taskless agent rule create`
- **THEN** the CLI SHALL NOT look up `rule-create.md` by joining the positionals
- **AND** it SHALL exit non-zero rather than guessing a topic
- **AND** it SHALL NOT read `create` as a section name

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

#### Scenario: A refused tool name is ignored on a topic without tool variants

- **WHEN** a user runs `taskless agent route --tool=vale`
- **THEN** the CLI SHALL print `route.md` and exit zero

#### Scenario: An unknown topic is not masked by a refused tool

- **WHEN** a user runs `taskless agent no-such-topic --tool=vale`
- **THEN** the CLI SHALL exit non-zero with the unknown-topic error, not the tool refusal

## ADDED Requirements

### Requirement: Long topics are served as an outline with sections on request

A recipe's `## ` headings outside fenced blocks SHALL divide it into sections, and everything before the first is its preamble: the header block and the one-command-per-call paragraph. Each section SHALL be addressable by the slug of its heading: lowercase, every run of characters other than letters and digits collapsed to one hyphen, with none leading or trailing. An author SHALL mark a section to be served on request by writing `<!-- on-demand -->` on the line directly above its heading. The marker SHALL be removed from every rendering, and a marker not directly above a `## ` heading SHALL fail when the recipes load.

`taskless agent <topic>` SHALL print the topic's outline: the preamble and every section not marked on demand, in order, then a `## Sections on request` section naming each section it left out and the command that prints one, `<invocation> agent <topic> --section <name>`, spelled with the `--tool` or `--anonymous` flag that selected the recipe. A recipe with no section marked on demand SHALL print unchanged. `taskless onboard` and `taskless update` (without `--rules`) SHALL print the same outline as `agent onboard` and `agent update`.

`--section <name>` SHALL print the preamble, that one section, and a closing line naming the command that prints the topic's outline. A name the topic has no section for SHALL exit 1 and list the topic's section names. `--full` SHALL print the whole recipe, identical to what `@taskless/cli/prompts` renders for the same options with the directive requested. The `@taskless/cli/prompts` export SHALL render the whole recipe.

A cross-reference to another section of the same recipe SHALL be written as a markdown link to its name, `[Quirks](#quirks)`. The whole recipe SHALL keep the link. The outline and a section SHALL rewrite a link to a section they do not print as that section's name. A cross-reference to a section of another topic SHALL be written as the command that prints it.

Each topic's outline, and each section printed on its own, SHALL fit 8 KiB when rendered with a nightly's invocation, the feedback invite included for a surveyed topic, enforced by a test. Every section link SHALL name a section of the same recipe and every `--section` citation a section of the cited topic, enforced by a test.

A section fetch SHALL capture `cli_agent` with `topic` and `section`, and SHALL NOT carry the feedback invite.

#### Scenario: A long topic prints its outline

- **WHEN** a user runs `taskless agent create-sg-rule`
- **THEN** stdout SHALL contain its steps
- **AND** SHALL NOT contain the sections marked on demand
- **AND** SHALL end with `## Sections on request`, listing `quirks` and the command that prints a section

#### Scenario: One section is printed

- **WHEN** a user runs `taskless agent create-sg-rule --section quirks`
- **THEN** stdout SHALL begin with the recipe's header block and one-command-per-call paragraph
- **AND** SHALL contain the `## Quirks` section and no other section

#### Scenario: An unknown section is refused

- **WHEN** a user runs `taskless agent create-sg-rule --section nope`
- **THEN** the CLI SHALL exit 1 and list the topic's section names on stderr

#### Scenario: The whole recipe is printed on request

- **WHEN** a user runs `taskless agent route --full`
- **THEN** stdout SHALL equal the `@taskless/cli/prompts` rendering of `route` with the directive requested

#### Scenario: A short topic is unchanged

- **WHEN** a user runs `taskless agent rule`
- **AND** `rule.md` marks no section on demand
- **THEN** stdout SHALL be the whole recipe, with no `## Sections on request`

#### Scenario: A link to a section left out names it

- **WHEN** a step links `[Quirks](#quirks)` and the outline does not print `quirks`
- **THEN** the outline SHALL read "section `quirks`" in its place
- **AND** the whole recipe SHALL keep the link

#### Scenario: Every topic fits the budget

- **WHEN** the test suite renders every recipe's outline and every section with a nightly's invocation
- **THEN** each SHALL be at most 8192 bytes, the feedback invite counted for a surveyed topic

#### Scenario: A section fetch is told apart in telemetry

- **WHEN** a user runs `taskless agent create-sg-rule --section quirks`
- **THEN** PostHog SHALL receive `cli_agent` with `topic: "create-sg-rule"` and `section: "quirks"`
- **AND** stdout SHALL NOT carry the feedback invite
