## ADDED Requirements

### Requirement: The package exposes knowledge prompts via a dedicated import

The package SHALL expose its knowledge prompts (the `help/*.txt` recipes) through a subpath export `@taskless/cli/prompts`, built into `dist` and listed in `files`, so consumers can import them without invoking the CLI.

#### Scenario: Importing a prompt by topic

- **WHEN** a consumer imports `getPrompt` (or `PROMPTS`) from `@taskless/cli/prompts`
- **THEN** it receives the recipe text for a known topic (e.g. `route`, `static`, `runtime`-adjacent authoring recipes) as a string

### Requirement: The prompt export is typed

The export SHALL provide a `PromptTopic` union of the available canonical topics, a `PROMPTS: Record<PromptTopic, (options?: PromptOptions) => string>` map of render functions, and a `getPrompt(topic, options?)` accessor over the same. Referencing an unknown topic SHALL be a compile-time error against `PromptTopic`.

#### Scenario: Typed access to topics

- **WHEN** a consumer calls `getPrompt("route")`
- **THEN** it type-checks and returns the `route` recipe; `getPrompt("nope")` fails type-checking against `PromptTopic`

#### Scenario: A topic is callable from the map

- **WHEN** a consumer calls `PROMPTS.route()` with no arguments
- **THEN** it returns the same string as `getPrompt("route")`

### Requirement: The export and the help command share one source and one renderer

The prompt export SHALL be sourced from the same embedded `help/*.txt` content that `commands/help.ts` serves, and SHALL render it through the same render path, with no duplicated embedding and no duplicated interpolation logic. Both surfaces SHALL return identical text for the same topic and equivalent options.

#### Scenario: Parity between import and help command

- **WHEN** the `help` command renders topic `T` and a consumer calls `getPrompt("T")`
- **THEN** the two texts are identical, including under a non-prod build target where the CLI invocation is rewritten

### Requirement: The export returns fully-rendered prompt text

Calling a prompt SHALL return finished text with every `%(KEY)s` placeholder substituted — `CLI_VERSION` from the build-time version, `INPUT_SCHEMA` from the corresponding Zod input schema, `PACKAGE_MANAGER_DLX` from `PromptOptions.packageManagerDlx` or its default agent-fill marker — and with the build-target CLI invocation applied. The returned text SHALL NOT require further templating by the consumer.

#### Scenario: Placeholders are resolved

- **WHEN** a consumer calls a prompt for a recipe whose source contains `%(CLI_VERSION)s`
- **THEN** the returned string contains the rendered version and no literal `%(...)s` placeholder

#### Scenario: Schema-bearing topics render their input schema

- **WHEN** a consumer calls the `rule-create` or `rule-improve` prompt
- **THEN** `%(INPUT_SCHEMA)s` is replaced by the JSON Schema rendered from that topic's Zod input schema

#### Scenario: Agent-fill marker defaults and overrides

- **WHEN** a consumer calls the `ci` prompt without options
- **THEN** `%(PACKAGE_MANAGER_DLX)s` renders as the default `<package-manager-dlx>` marker; supplying `packageManagerDlx` substitutes that value instead

### Requirement: The version header is suppressible

Rendered prompts SHALL begin with a header line naming the topic and the CLI version. Because that version participates in an LLM consumer's prompt-cache key, `PromptOptions.header` SHALL allow suppressing it. It SHALL default to `true`, leaving the `help` command's output and all existing behavior unchanged.

#### Scenario: Header suppressed for a cache-stable system prompt

- **WHEN** a consumer calls a prompt with `header: false`
- **THEN** the returned text omits the `# Topic: …` line and contains no CLI version string, while the body is otherwise identical to the default rendering

#### Scenario: Header present by default

- **WHEN** a prompt is called with no options, or the `help` command renders a topic
- **THEN** the header line is present, exactly as it renders today

#### Scenario: Build defines are inlined into the prompts entry

- **WHEN** a rendered prompt is inspected from the built `dist/prompts.js`
- **THEN** it contains no un-inlined build-define identifier (e.g. a literal `__VERSION__`)

### Requirement: The prompts import is free of CLI runtime dependencies

The `@taskless/cli/prompts` module SHALL contain only embedded prompt data, types, and the render path — no `citty` command tree, telemetry, filesystem, or network imports — so importing it does not load `@taskless/cli`'s main entry. Its permitted runtime imports are the templating library and the leaf Zod input schemas required for rendering.

#### Scenario: Worker-safe import

- **WHEN** a consumer imports `@taskless/cli/prompts`
- **THEN** the module resolves without pulling in `dist/index.js` or its CLI runtime dependencies

### Requirement: Anonymous variants are accessible distinctly from canonical

Where a `<topic>.anonymous.txt` variant exists, the export SHALL make it retrievable distinctly via `PromptOptions.anonymous`, falling back to the canonical recipe when no variant exists.

#### Scenario: Anonymous variant retrieval and fallback

- **WHEN** a consumer requests the anonymous variant of a topic that has one
- **THEN** it receives the `.anonymous` text; for a topic without a variant, it receives the canonical text

### Requirement: Topic names and accessor shape are stable public API

The set of `PromptTopic` names, the `getPrompt`/`PROMPTS` shape, and the existing fields of `PromptOptions` SHALL be treated as public API under semver; recipe _text_ MAY change within a major version.

#### Scenario: Removing a topic is a breaking change

- **WHEN** a topic is removed or renamed, or the accessor signature changes
- **THEN** it SHALL be released as a major version bump; a text edit SHALL NOT

#### Scenario: Adding an option is not a breaking change

- **WHEN** a new optional field is added to `PromptOptions`
- **THEN** it SHALL NOT require a major version bump, since existing call sites keep their behavior

### Requirement: Topic membership is explicit and verified against the recipe files

`PromptTopic` SHALL be derived from an explicit, hand-maintained list of exported topics rather than inferred from whatever recipe files are present, so that adding or removing a `help/*.txt` file cannot silently change the public API. Recipe files deliberately withheld from the export SHALL be recorded in an explicit internal-topics list.

An automated check SHALL assert that the set of canonical `help/*.txt` topics on disk is exactly the union of the exported topics and the internal-topics list, failing when the two diverge in either direction.

#### Scenario: A new recipe file is added without being classified

- **WHEN** a new canonical `help/<topic>.txt` is added and appears in neither the exported topics nor the internal-topics list
- **THEN** the completeness check SHALL fail, requiring the author to either export the topic or record it as internal

#### Scenario: An exported topic loses its recipe file

- **WHEN** a topic remains in `PromptTopic` but its canonical `help/<topic>.txt` no longer exists
- **THEN** the completeness check SHALL fail, rather than the topic rendering empty or undefined at runtime

#### Scenario: A deliberately internal recipe stays unexported

- **WHEN** a recipe file is listed as internal
- **THEN** the check SHALL pass and the topic SHALL NOT be a member of `PromptTopic`
