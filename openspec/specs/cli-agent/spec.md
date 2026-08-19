# CLI Agent

## Purpose

Defines the `agent` subcommand for the `@taskless/cli` package, including recipe display, embedding, and formatting.

## Requirements

### Requirement: Agent subcommand serves recipes for commands

The CLI SHALL support an `agent` subcommand that accepts at most one positional argument identifying a topic AND an optional `--anonymous` boolean flag. Topics SHALL be addressed by a single token; the subcommand SHALL NOT join multiple positionals into a topic key. When a topic is provided, the subcommand SHALL look up a matching recipe file embedded at build time using the following resolution order:

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

### Requirement: Recipe files are embedded at build time

Recipe files SHALL be located at `packages/cli/src/agent/` as plain `.txt` files. The Vite build SHALL embed these files into the CLI bundle via `import.meta.glob` with raw imports. A recipe file SHALL exist for every registered command and subcommand.

#### Scenario: Recipe files are available without filesystem access

- **WHEN** the CLI is invoked via `npx @taskless/cli agent check`
- **THEN** the recipe SHALL be served from the embedded bundle without reading the filesystem

#### Scenario: Recipe file naming convention

- **WHEN** a recipe file is created for the `rule create` subcommand
- **THEN** the file SHALL be named `rule-create.txt` in `packages/cli/src/agent/`

### Requirement: Recipe files follow a consistent format

Every recipe file at `packages/cli/src/agent/<topic>.txt` SHALL follow the canonical recipe template: a single-line header `# Topic: <name>     (CLI v%(CLI_VERSION)s / topic v<n>)`, followed by `## Goal`, `## Preconditions`, `## Steps`, optional `## Input schema` (for recipes that take `--from`), `## Errors`, and `## See Also` sections in that order. Recipe templates SHALL use sprintf-js `%(KEY)s` named-argument placeholders for all substitution. The header SHALL embed `%(CLI_VERSION)s` for the CLI version. Topics that document a `--from` input SHALL embed `%(INPUT_SCHEMA)s` inside the `## Input schema` fenced code block. The topic version integer in the header SHALL be a literal value maintained by the recipe author and bumped when the recipe changes meaningfully.

#### Scenario: Recipe contains all template sections

- **WHEN** any `<topic>.txt` file is read
- **THEN** it SHALL begin with a `# Topic:` header containing `%(CLI_VERSION)s` and the topic version integer
- **AND** SHALL contain `## Goal`, `## Preconditions`, `## Steps`, `## Errors`, and `## See Also` sections in that order

#### Scenario: Recipe with --from input includes JSON schema placeholder

- **WHEN** a topic recipe documents a CLI invocation that uses `--from <file>`
- **THEN** the recipe SHALL contain an `## Input schema` section with a code-fenced block containing the `%(INPUT_SCHEMA)s` placeholder
- **AND** the JSON Schema SHALL be derived at render time from the corresponding Zod schema in `packages/cli/src/schemas/`

#### Scenario: Header version reflects build-time CLI version

- **WHEN** the CLI bundle is built
- **THEN** the recipe header's `%(CLI_VERSION)s` placeholder SHALL be substituted at render time from `packages/cli/package.json`
- **AND** SHALL match the version reported by `taskless info`

### Requirement: Recipe substitution uses sprintf-js named arguments

Recipe rendering SHALL substitute placeholders via `sprintf-js` using its named-argument form (`%(KEY)s`). The renderer SHALL build a variables table for each render call containing two flavors of substitution:

1. **System-resolved values** — keys whose values come from runtime state. The renderer SHALL provide `CLI_VERSION` (resolved from the build-time version constant) for every render. The renderer SHALL provide `INPUT_SCHEMA` only when the recipe content contains the `%(INPUT_SCHEMA)s` placeholder; the value is the JSON Schema rendered from the topic's Zod schema in `packages/cli/src/schemas/`, or the literal string `"(no input schema for this topic)"` when no Zod schema is registered for the topic.
2. **Agent-fill markers** — keys whose values render as a lowercase angle-bracket token of the same name (e.g. `PACKAGE_MANAGER_DLX` renders as `<package-manager-dlx>`). The renderer SHALL provide `PACKAGE_MANAGER_DLX` for every render. Agent-fill markers exist so the consuming agent can substitute the value at execution time without the recipe having to invent a per-recipe placeholder convention.

Recipe authors SHALL escape any literal `%` character in recipe content as `%%` per sprintf-js conventions. The renderer SHALL NOT introduce any other placeholder syntax (`{{KEY}}`, `${KEY}`, etc.); all substitution SHALL flow through the sprintf-js named-argument table.

#### Scenario: CLI_VERSION substitutes the build-time version

- **WHEN** any recipe is rendered
- **THEN** every `%(CLI_VERSION)s` occurrence SHALL be replaced with the build-time CLI version

#### Scenario: INPUT_SCHEMA substitutes only when present in the recipe

- **WHEN** a recipe contains `%(INPUT_SCHEMA)s`
- **THEN** it SHALL be replaced with the JSON Schema rendered from the topic's Zod schema
- **AND** when no Zod schema is registered for the topic, the placeholder SHALL render as `(no input schema for this topic)`

#### Scenario: PACKAGE_MANAGER_DLX renders as an agent-fill marker

- **WHEN** any recipe contains `%(PACKAGE_MANAGER_DLX)s`
- **THEN** the rendered output SHALL contain the literal token `<package-manager-dlx>` at every occurrence

#### Scenario: No legacy placeholder syntax remains in recipes

- **WHEN** any `<topic>.txt` file under `packages/cli/src/agent/` is read
- **THEN** it SHALL NOT contain a `{{KEY}}` mustache-style placeholder
- **AND** all substitution SHALL be expressed as `%(KEY)s` sprintf-js named arguments

### Requirement: onboard topic is registered in the agent index

An agent topic `onboard` SHALL be registered. The CLI SHALL embed `packages/cli/src/agent/onboard.txt` at build time via the existing `import.meta.glob` mechanism. `taskless agent onboard` SHALL print the contents of `onboard.txt`. The topic SHALL appear in the output of `taskless agent` (the index) with a one-line summary describing it as the post-install rule-discovery flow.

#### Scenario: The onboard topic returns the recipe

- **WHEN** a user runs `taskless agent onboard`
- **THEN** the CLI SHALL print the contents of `onboard.txt` to stdout
- **AND** SHALL exit with code 0

#### Scenario: Topic index includes onboard

- **WHEN** a user runs `taskless agent` (no args)
- **THEN** the topic index SHALL include a row for `onboard`
- **AND** the row SHALL describe it as the post-install rule-discovery flow

### Requirement: onboard intent telemetry

Fetching the `onboard` topic SHALL emit the command's single intent event, `cli_agent`, carrying `onboard` as its `topic` property.

Per-topic event names (`help_onboard` and siblings) are not emitted. One event with a topic property is filterable the same way and does not grow the event vocabulary every time a topic is added or renamed, which this change would otherwise have to do for every rename below.

#### Scenario: Fetching onboard captures its topic

- **WHEN** an agent runs `taskless agent onboard`
- **THEN** PostHog SHALL receive a `cli_agent` event whose `topic` property is `onboard`

### Requirement: Routing topics are registered in the agent system

The agent system SHALL register `route` and each `create-*-rule` recipe as embedded topics, retrievable via `taskless agent <topic>` and listed in the topic index, consistent with the existing topic embedding and format requirements.

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

Fetching a routing recipe SHALL emit the command's single intent event, `cli_agent`, carrying the served topic as its `topic` property.

#### Scenario: Intent is captured for routing recipes

- **WHEN** the agent fetches `route` or any `create-*-rule` topic
- **THEN** the command SHALL capture a `cli_agent` event whose `topic` property is that topic name

### Requirement: Anonymous variant lookup uses a compile-time map

The `agent` command SHALL construct, at build time, a Set of topic names that have a corresponding `<topic>.anonymous.txt` file. Lookup at runtime SHALL be O(1). The Set SHALL be derived from `import.meta.glob` matching `*.anonymous.txt` in the recipe directory.

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

### Requirement: Agent command emits intent telemetry

The `agent` command SHALL emit one PostHog event, `cli_agent`, on every invocation, carrying a `topic` property:

- the served topic when a positional resolves to a known topic
- the attempted topic string when it resolves to none
- `(index)` when called with no positional arguments
- the joined positionals when more than one is supplied

#### Scenario: Topic fetch captures the topic

- **WHEN** an agent runs `taskless agent create-sg-rule`
- **THEN** PostHog SHALL receive a `cli_agent` event whose `topic` property is `create-sg-rule`

#### Scenario: Index fetch captures the index

- **WHEN** an agent runs `taskless agent` (no args)
- **THEN** PostHog SHALL receive a `cli_agent` event whose `topic` property is `(index)`

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
