# CLI Help

## Purpose

TBD — Defines the help subcommand for the `@taskless/cli` package, including help text display, embedding, and formatting.

## Requirements

### Requirement: Help subcommand displays rich help text for commands

The CLI SHALL support a `help` subcommand that accepts zero or more positional arguments identifying a topic path AND an optional `--anonymous` boolean flag. When positional arguments are provided, the help subcommand SHALL look up a matching help text file embedded at build time using the following resolution order:

1. If `--anonymous` is set AND `<topic>.anonymous.txt` exists in the embedded map, return that file.
2. Otherwise, return `<topic>.txt`.
3. If neither exists, exit with code 1 and an error message suggesting `taskless help` for the topic index.

When no positional arguments are provided, the help subcommand SHALL print a topic index containing a one-paragraph human slug followed by a topic disambiguation table mapping topic names to their summaries.

#### Scenario: Help for a topic returns the recipe

- **WHEN** a user runs `taskless help check`
- **THEN** the CLI SHALL print the contents of `check.txt` to stdout

#### Scenario: Help for a nested topic joins with hyphens

- **WHEN** a user runs `taskless help rule create`
- **THEN** the CLI SHALL look up `rule-create.txt` and print its contents

#### Scenario: Help with --anonymous returns the variant when present

- **WHEN** a user runs `taskless help rule create --anonymous`
- **AND** `rule-create.anonymous.txt` exists in the embedded help map
- **THEN** the CLI SHALL print the contents of `rule-create.anonymous.txt`

#### Scenario: Help with --anonymous falls back when no variant exists

- **WHEN** a user runs `taskless help check --anonymous`
- **AND** no `check.anonymous.txt` exists
- **THEN** the CLI SHALL print the contents of `check.txt` (no error, no warning — anonymous is a no-op for this topic)

#### Scenario: Help with no arguments shows index with human slug and disambiguation table

- **WHEN** a user runs `taskless help`
- **THEN** the CLI SHALL print a one-paragraph human-facing slug explaining what the help command does for human vs. agent audiences
- **AND** SHALL print a topic table mapping each topic name to its one-line summary
- **AND** SHALL include a note about the `--anonymous` flag

#### Scenario: Help for an unknown topic exits with error

- **WHEN** a user runs `taskless help nonexistent`
- **THEN** the CLI SHALL print an error message indicating the topic is not recognized
- **AND** exit with code 1

### Requirement: Help text files are embedded at build time

Help text files SHALL be located at `packages/cli/src/help/` as plain `.txt` files. The Vite build SHALL embed these files into the CLI bundle via `import.meta.glob` with raw imports. A help file SHALL exist for every registered command and subcommand.

#### Scenario: Help files are available without filesystem access

- **WHEN** the CLI is invoked via `npx @taskless/cli help check`
- **THEN** the help text SHALL be served from the embedded bundle without reading the filesystem

#### Scenario: Help file naming convention

- **WHEN** a help file is created for the `rule create` subcommand
- **THEN** the file SHALL be named `rule-create.txt` in `packages/cli/src/help/`

### Requirement: Help text files follow a consistent format

Every help text file at `packages/cli/src/help/<topic>.txt` SHALL follow the canonical recipe template: a single-line header `# Topic: <name>     (CLI v%(CLI_VERSION)s / topic v<n>)`, followed by `## Goal`, `## Preconditions`, `## Steps`, optional `## Input schema` (for recipes that take `--from`), `## Errors`, and `## See Also` sections in that order. Recipe templates SHALL use sprintf-js `%(KEY)s` named-argument placeholders for all substitution. The header SHALL embed `%(CLI_VERSION)s` for the CLI version. Topics that document a `--from` input SHALL embed `%(INPUT_SCHEMA)s` inside the `## Input schema` fenced code block. The topic version integer in the header SHALL be a literal value maintained by the recipe author and bumped when the recipe changes meaningfully.

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

- **WHEN** any `<topic>.txt` file under `packages/cli/src/help/` is read
- **THEN** it SHALL NOT contain a `{{KEY}}` mustache-style placeholder
- **AND** all substitution SHALL be expressed as `%(KEY)s` sprintf-js named arguments

### Requirement: onboard topic is registered in the help index

A new help topic `onboard` SHALL be registered. The CLI SHALL embed `packages/cli/src/help/onboard.txt` at build time via the existing `import.meta.glob` mechanism. `taskless help onboard` SHALL print the contents of `onboard.txt`. The topic SHALL appear in the output of `taskless help` (the index) with a one-line summary describing it as the post-install rule-discovery flow.

#### Scenario: Help for onboard returns the recipe

- **WHEN** a user runs `taskless help onboard`
- **THEN** the CLI SHALL print the contents of `onboard.txt` to stdout
- **AND** SHALL exit with code 0

#### Scenario: Help index includes onboard

- **WHEN** a user runs `taskless help` (no args)
- **THEN** the topic table SHALL include a row for `onboard`
- **AND** the row SHALL describe it as the post-install rule-discovery flow

#### Scenario: Onboard recipe is embedded at build time

- **WHEN** the CLI bundle is built
- **THEN** `import.meta.glob` matching the help directory SHALL include `onboard.txt`
- **AND** the recipe SHALL be available at runtime without filesystem access

#### Scenario: Help onboard with --anonymous falls back

- **WHEN** a user runs `taskless help onboard --anonymous`
- **AND** no `onboard.anonymous.txt` exists
- **THEN** the CLI SHALL print the contents of `onboard.txt` (anonymous is a no-op for this topic)

### Requirement: help_onboard intent telemetry

The help command's existing intent-telemetry requirement SHALL extend naturally to the new topic: invocations of `taskless help onboard` SHALL emit a `help_onboard` PostHog event, consistent with the `help_<topic>` pattern.

#### Scenario: Help onboard emits help_onboard

- **WHEN** an agent runs `taskless help onboard`
- **THEN** PostHog SHALL receive a `help_onboard` event

### Requirement: Routing topics are registered in the help system

The help system SHALL register the routing recipes `route`, `existing`, `static`,
and `remote` as embedded help topics, retrievable via `taskless help <topic>` and
listed in the help index, consistent with the existing topic embedding and format
requirements.

#### Scenario: Routing topics resolve

- **WHEN** `taskless help route`, `taskless help existing`,
  `taskless help static`, or `taskless help remote` is run
- **THEN** the corresponding recipe text SHALL be returned
- **AND** an unknown-topic error SHALL NOT be raised for any of the four

#### Scenario: Routing topics appear in the index

- **WHEN** `taskless help` (no arguments) is run
- **THEN** the topic index SHALL include the routing topics so an agent can
  discover the authoring front door

### Requirement: Routing topics emit intent telemetry

Fetching a routing recipe SHALL emit a per-topic intent telemetry event,
consistent with the existing `help_<topic>` telemetry convention.

#### Scenario: Help topic intent is captured for routing recipes

- **WHEN** the agent fetches `route`, `existing`, `static`, or `remote`
- **THEN** the help command SHALL capture the corresponding `help_<topic>` intent
  event with the topic name

### Requirement: The engine-selection topic is registered in the help system

The help system SHALL register the engine-selection recipe as an embedded help topic, retrievable via `taskless help <topic>` and listed in the help index, consistent with the existing topic embedding and format requirements.

#### Scenario: Engine-selection topic resolves

- **WHEN** `taskless help` is run for the engine-selection topic
- **THEN** the recipe text SHALL be returned and an unknown-topic error SHALL NOT be raised

#### Scenario: Engine-selection topic appears in the index

- **WHEN** `taskless help` is run with no arguments
- **THEN** the topic index SHALL include the engine-selection topic so an agent can discover it

### Requirement: Routing recipes reference engine selection

The `route` and `static` recipes SHALL reference the engine-selection topic so an agent following the local authoring flow applies the same engine test the service applies, rather than assuming ast-grep.

#### Scenario: Local flow reaches engine selection

- **WHEN** an agent follows `route` to a destination that authors a Taskless rule
- **THEN** the recipe directs it to the engine-selection topic before the rule is authored

## Goal

<one paragraph stating what this recipe accomplishes>

## Preconditions

<bulleted list of state required before running, including auth state>

## Steps

<numbered list of agent-facing steps>

## Input schema

<for recipes that take a --from input: a code-fenced JSON Schema block
generated from the corresponding Zod schema via zod-to-json-schema>

## Errors

<table mapping error code to user-facing fix>

## See Also

<bulleted list of related topics>
```

The header line SHALL include the CLI version (interpolated at build time) and a topic version integer maintained by the recipe author and bumped when the recipe changes meaningfully.

#### Scenario: Recipe contains all template sections

- **WHEN** any `<topic>.txt` file is read
- **THEN** it SHALL begin with the `# Topic: <name> (CLI v<x.y.z> / topic v<n>)` header
- **AND** SHALL contain `## Goal`, `## Preconditions`, `## Steps`, `## Errors`, and `## See Also` sections in that order

#### Scenario: Recipe with --from input includes JSON schema

- **WHEN** a topic recipe documents a CLI invocation that uses `--from <file>`
- **THEN** the recipe SHALL contain an `## Input schema` section with a code-fenced JSON Schema block
- **AND** the JSON Schema SHALL be derived from the corresponding Zod schema in `packages/cli/src/schemas/`

#### Scenario: Header version reflects build-time CLI version

- **WHEN** the CLI bundle is built
- **THEN** the recipe header's CLI version SHALL be interpolated at build time from `packages/cli/package.json`
- **AND** SHALL match the version reported by `taskless info`

### Requirement: Anonymous variant lookup uses a compile-time map

The help command SHALL construct, at build time, a Set of topic names that have a corresponding `<topic>.anonymous.txt` file. Lookup at runtime SHALL be O(1). The Set SHALL be derived from `import.meta.glob` matching `*.anonymous.txt` in the help directory.

#### Scenario: Topics with variants are detected at build time

- **WHEN** the CLI bundle is built
- **AND** files `rule-create.anonymous.txt` and `rule-improve.anonymous.txt` exist
- **THEN** the embedded variants set SHALL contain `rule-create` and `rule-improve`

#### Scenario: Topics without variants are absent from the map

- **WHEN** the CLI bundle is built
- **AND** no `check.anonymous.txt` file exists
- **THEN** the embedded variants set SHALL NOT contain `check`
- **AND** `taskless help check --anonymous` SHALL fall back to `check.txt`

### Requirement: Embedded JSON schemas are generated via zod-to-json-schema

For every recipe topic that documents a CLI command accepting `--from <file>`, the corresponding Zod input schema in `packages/cli/src/schemas/` SHALL be converted to JSON Schema via `zod-to-json-schema` and embedded in the recipe's `## Input schema` section as a fenced code block. Generation MAY happen at runtime (small dep, fast) or at build time; runtime is acceptable.

#### Scenario: rule create recipe embeds input schema

- **WHEN** a user runs `taskless help rule create`
- **THEN** the output SHALL contain an `## Input schema` section
- **AND** the section SHALL contain a code-fenced JSON Schema block derived from the `rules-create` Zod schema (or the renamed `rule-create` schema)

#### Scenario: rule improve recipe embeds input schema

- **WHEN** a user runs `taskless help rule improve`
- **THEN** the output SHALL contain an `## Input schema` section with the rule-improve JSON Schema

### Requirement: Help command emits intent telemetry

The help command SHALL emit a PostHog event on every invocation:

- `help_<topic>` (e.g. `help_rule_create`, `help_check`, `help_auth`) when called with positional arguments resolving to a known topic
- `help_index` when called with no positional arguments
- `help_unknown` (with the attempted topic as a property) when called with positional arguments resolving to no topic

These events SHALL replace the previous `cli_help_<topic>` events in a single hard rename.

#### Scenario: Topic fetch emits intent event

- **WHEN** an agent runs `taskless help rule create`
- **THEN** PostHog SHALL receive a `help_rule_create` event

#### Scenario: Index fetch emits help_index

- **WHEN** an agent runs `taskless help` (no args)
- **THEN** PostHog SHALL receive a `help_index` event
