## ADDED Requirements

### Requirement: The package exposes knowledge prompts via a dedicated import

The package SHALL expose its knowledge prompts (the `help/*.txt` recipes) through a subpath export `@taskless/cli/prompts`, built into `dist` and listed in `files`, so consumers can import them without invoking the CLI.

#### Scenario: Importing a prompt by topic

- **WHEN** a consumer imports `getPrompt` (or `PROMPTS`) from `@taskless/cli/prompts`
- **THEN** it receives the recipe text for a known topic (e.g. `route`, `static`, `runtime`-adjacent authoring recipes) as a string

### Requirement: The prompt export is typed

The export SHALL provide a `PromptTopic` union of the available canonical topics, a `PROMPTS: Record<PromptTopic, string>` map, and a `getPrompt(topic, opts?)` accessor. Referencing an unknown topic SHALL be a compile-time error against `PromptTopic`.

#### Scenario: Typed access to topics

- **WHEN** a consumer calls `getPrompt("route")`
- **THEN** it type-checks and returns the `route` recipe; `getPrompt("nope")` fails type-checking against `PromptTopic`

### Requirement: The export and the help command share one source

The prompt export SHALL be sourced from the same embedded `help/*.txt` content that `commands/help.ts` serves, with no duplicated embedding. Both surfaces SHALL return identical text for the same topic.

#### Scenario: Parity between import and help command

- **WHEN** the `help` command renders topic `T` with no interpolation and a consumer reads `getPrompt("T")`
- **THEN** the two texts are identical (single source of truth)

### Requirement: The export returns raw recipe text

The export SHALL return recipe text verbatim, including any `%(KEY)s` placeholders; it SHALL NOT interpolate CLI runtime values. Interpolation remains a CLI-side concern.

#### Scenario: Placeholders are preserved

- **WHEN** a consumer reads a recipe that contains `%(CLI_VERSION)s` or similar
- **THEN** the returned string still contains the literal `%(...)s` placeholder, un-substituted

### Requirement: The prompts import is free of CLI runtime dependencies

The `@taskless/cli/prompts` module SHALL contain only embedded prompt data and types — no `citty` command tree, telemetry, or other CLI runtime imports — so importing it does not load `@taskless/cli`'s main entry.

#### Scenario: Worker-safe import

- **WHEN** a consumer imports `@taskless/cli/prompts`
- **THEN** the module resolves without pulling in `dist/index.js` or its CLI runtime dependencies

### Requirement: Anonymous variants are accessible distinctly from canonical

Where a `<topic>.anonymous.txt` variant exists, the export SHALL make it retrievable distinctly (e.g. `getPrompt(topic, { anonymous: true })`), falling back to the canonical recipe when no variant exists.

#### Scenario: Anonymous variant retrieval and fallback

- **WHEN** a consumer requests the anonymous variant of a topic that has one
- **THEN** it receives the `.anonymous` text; for a topic without a variant, it receives the canonical text

### Requirement: Topic names and accessor shape are stable public API

The set of `PromptTopic` names and the `getPrompt`/`PROMPTS` shape SHALL be treated as public API under semver; recipe _text_ MAY change within a major version.

#### Scenario: Removing a topic is a breaking change

- **WHEN** a topic is removed or renamed, or the accessor signature changes
- **THEN** it SHALL be released as a major version bump; a text edit SHALL NOT
