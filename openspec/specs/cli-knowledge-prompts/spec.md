# cli-knowledge-prompts Specification

## Purpose

The CLI's `agent/*.txt` recipes are the authoritative guidance Taskless gives an
agent about authoring and operating rules. Until now the only way to read them
was to run `taskless agent`, which puts them out of reach of anything that cannot
spawn the CLI — notably the service-side generator, which needs the same text to
brief a model.

This capability publishes those recipes as a typed subpath export,
`@taskless/cli/prompts`, rendered through the same embed and the same render
path the `agent` command uses. One source and one renderer means the two surfaces
cannot drift into giving different guidance. The export carries no CLI runtime,
so a Worker can import it without dragging in the command tree, and topic
membership is an explicit hand-maintained list so a new recipe file cannot
silently become public API.

## Requirements

### Requirement: The package exposes knowledge prompts via a dedicated import

The package SHALL expose its knowledge prompts (the `agent/*.txt` recipes) through a subpath export `@taskless/cli/prompts`, built into `dist` and listed in `files`, so consumers can import them without invoking the CLI.

#### Scenario: Importing a prompt by topic

- **WHEN** a consumer imports `getPrompt` (or `PROMPTS`) from `@taskless/cli/prompts`
- **THEN** it receives the recipe text for a known topic (e.g. `static`) as a string

### Requirement: The prompt export is typed

The export SHALL provide a `PromptTopic` union of the available canonical topics, a `PROMPTS: Record<PromptTopic, (options?: PromptOptions) => string>` map of render functions, and a `getPrompt(topic, options?)` accessor over the same. Referencing an unknown topic SHALL be a compile-time error against `PromptTopic`.

#### Scenario: Typed access to topics

- **WHEN** a consumer calls `getPrompt("static")`
- **THEN** it type-checks and returns the `static` recipe; `getPrompt("nope")` fails type-checking against `PromptTopic`

#### Scenario: A topic is callable from the map

- **WHEN** a consumer calls `PROMPTS.static()` with no arguments
- **THEN** it returns the same string as `getPrompt("static")`

### Requirement: The export and the agent command share one source and one renderer

The prompt export SHALL be sourced from the same embedded `agent/*.txt` content that `commands/agent.ts` serves, and SHALL render it through the same render path, with no duplicated embedding and no duplicated interpolation logic. Both surfaces SHALL return identical text for the same topic and equivalent options.

#### Scenario: Parity between import and agent command

- **WHEN** the `agent` command renders topic `T` and a consumer calls `getPrompt("T")`
- **THEN** the two texts are identical, including under a non-prod build target where the CLI invocation is rewritten

### Requirement: The export returns fully-rendered prompt text

Calling a prompt SHALL return finished text with every `%(KEY)s` placeholder substituted — `CLI_VERSION` from the build-time version, `INPUT_SCHEMA` from the corresponding Zod input schema, `PACKAGE_MANAGER_DLX` from `PromptOptions.packageManagerDlx` or its default agent-fill marker, and `TASKLESS_CLI` from `PromptOptions.invocation`, the non-prod build-target invocation, or its default agent-fill marker `<taskless-cli>` — and with the build-target CLI invocation applied. The returned text SHALL NOT require further templating by the consumer.

`PromptOptions.invocation` SHALL be the only way a consumer influences `TASKLESS_CLI`. The render path SHALL NOT read `process`, the environment, or `argv` to discover the answer for itself: the module is imported by Workers without `nodejs_compat`, where a module-scope `process` read throws at import time, and a build-graph check cannot catch that because `process` is a global rather than an import. Detection therefore lives in the CLI, which passes the result in.

#### Scenario: Placeholders are resolved

- **WHEN** a consumer calls a prompt for a recipe whose source contains `%(CLI_VERSION)s`
- **THEN** the returned string contains the rendered version and no literal `%(...)s` placeholder

#### Scenario: Schema-bearing topics render their input schema

- **WHEN** a recipe carrying `%(INPUT_SCHEMA)s` is rendered (today `create-remote-rule` and `improve-rule`, both internal topics)
- **THEN** the placeholder is replaced by the JSON Schema rendered from that topic's Zod input schema

#### Scenario: Agent-fill marker defaults and overrides

- **WHEN** a recipe carrying `%(PACKAGE_MANAGER_DLX)s` is rendered without options (today `ci`, an internal topic)
- **THEN** the placeholder renders as the default `<package-manager-dlx>` marker; supplying `packageManagerDlx` substitutes that value instead

#### Scenario: A host importing the export gets the marker

- **WHEN** a consumer imports `@taskless/cli/prompts` from a prod build and renders a topic without supplying `invocation`
- **THEN** every `%(TASKLESS_CLI)s` occurrence renders as `<taskless-cli>`, leaving the host free to substitute the launcher it actually offers

#### Scenario: A supplied invocation is used verbatim

- **WHEN** a consumer supplies `invocation: "pnpm dlx @taskless/cli@latest"`
- **THEN** every `%(TASKLESS_CLI)s` occurrence renders as that string

### Requirement: The version header is suppressible

Rendered prompts SHALL begin with a header line naming the topic and the CLI version. Because that version participates in an LLM consumer's prompt-cache key, `PromptOptions.header` SHALL allow suppressing it. It SHALL default to `true`, leaving the `agent` command's output and all existing behavior unchanged.

#### Scenario: Header suppressed for a cache-stable system prompt

- **WHEN** a consumer calls a prompt with `header: false`
- **THEN** the returned text omits the `# Topic: …` line and contains no CLI version string, while the body is otherwise identical to the default rendering

#### Scenario: Header present by default

- **WHEN** a prompt is called with no options, or the `agent` command renders a topic
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

The set of `PromptTopic` names, the `getPrompt`/`PROMPTS` shape, and the existing fields of `PromptOptions` SHALL be treated as public API; recipe _text_ MAY change freely.

The package is pre-1.0, so a backwards-incompatible change to that surface SHALL be released as a **MINOR** bump. This is what the leading zero means, and it applies to renaming a topic, removing one, or changing the accessor signature.

What the requirement actually protects is not the version number but the notice. `TOPICS` is consumed across a deploy boundary, so a downstream consumer breaks when it upgrades rather than when this package builds, and the version alone cannot warn anyone. A breaking change SHALL therefore name the removed or renamed topics explicitly in its changeset.

#### Scenario: Renaming or removing a topic

- **WHEN** a topic is removed or renamed, or the accessor signature changes
- **THEN** it SHALL be released as a MINOR bump
- **AND** the changeset SHALL name the removed or renamed topics
- **AND** a recipe text edit SHALL require neither

#### Scenario: Adding an option

- **WHEN** a new optional field is added to `PromptOptions`
- **THEN** it SHALL NOT require more than a PATCH bump, since existing call sites keep their behavior

### Requirement: Topic membership is explicit and verified against the recipe files

`PromptTopic` SHALL be derived from an explicit, hand-maintained list of exported topics rather than inferred from whatever recipe files are present, so that adding or removing an `agent/*.txt` file cannot silently change the public API. Recipe files deliberately withheld from the export SHALL be recorded in an explicit internal-topics list.

An automated check SHALL assert that the set of canonical `agent/*.txt` topics on disk is exactly the union of the exported topics and the internal-topics list, failing when the two diverge in either direction.

#### Scenario: A new recipe file is added without being classified

- **WHEN** a new canonical `agent/<topic>.txt` is added and appears in neither the exported topics nor the internal-topics list
- **THEN** the completeness check SHALL fail, requiring the author to either export the topic or record it as internal

#### Scenario: An exported topic loses its recipe file

- **WHEN** a topic remains in `PromptTopic` but its canonical `agent/<topic>.txt` no longer exists
- **THEN** the completeness check SHALL fail, rather than the topic rendering empty or undefined at runtime

#### Scenario: A deliberately internal recipe stays unexported

- **WHEN** a recipe file is listed as internal
- **THEN** the check SHALL pass and the topic SHALL NOT be a member of `PromptTopic`

### Requirement: Exported topics cover every engine a rule can be routed to

`TOPICS` SHALL export `route`, the recipe that chooses an authoring destination, and the authoring recipe for each engine it can choose — `create-sg-rule`, `create-vale-rule`, and `create-runtime-rule`.

A consumer that can decide a rule belongs to an engine must be able to reach the procedure for authoring one, and a consumer that can author for each engine must be able to reach the choice between them. Exporting either half alone strands the other, and the two are not symmetric in their consequences: a consumer missing a destination stops, while **a consumer missing the chooser writes its own**, which is the divergence this export exists to prevent.

`route` was withheld on the grounds that it contains local mechanics a service consumer cannot run, and that such a consumer could adjudicate a genuinely ambiguous call from the three destinations. The first is true and does not follow: a consumer ignores the mechanics, which is a smaller adaptation than restating the criteria. The second was tried and failed in production — the platform generator hand-wrote the same judgement, reached a two-value classification with no way to name `vale`, and generated every prose rule as an ast-grep rule while its own delivery layer could already serve a Vale one.

`engine-selection` leaves the export because it stops existing: the criterion it carried now lives in `route`, stated once.

#### Scenario: The chooser is reachable from the export

- **WHEN** a consumer imports `TOPICS`
- **THEN** it SHALL contain `route`
- **AND** `route` SHALL be a member of `PromptTopic`

#### Scenario: Every engine's authoring path is reachable from the export

- **WHEN** a consumer imports `TOPICS`
- **THEN** it SHALL contain `create-sg-rule`, `create-vale-rule`, and `create-runtime-rule`

#### Scenario: The exported set follows the rename

- **WHEN** a consumer imports `TOPICS`
- **THEN** it SHALL NOT contain `static` or `engine-selection`, neither of which names a recipe any more

### Requirement: The export provides rendered and raw instruction accessors

The export SHALL provide `getInstructions(topic, options?)` and `getRawInstructions(topic, options?)`, each returning `{ text: string; variables: string[] }`.

`getInstructions` SHALL return finished text — the same string `getPrompt` returns for the same topic and options — alongside the names of the sprintf variables the topic's template contains. `getRawInstructions` SHALL return the **unrendered** template text alongside the same variable names, so a host that knows a value the package cannot know can render it itself.

**Not every variable is one a host can know.** The names a raw consumer receives cover two kinds: values a host may supply — `TASKLESS_CLI` and `PACKAGE_MANAGER_DLX`, each with an agent-fill marker as its default — and values only the package can resolve, which include the build version, the pinned engine capabilities, an input schema, and any pre-composed block a rendering option selects between. A host rendering the raw template itself SHALL substitute the first kind and SHALL take the second from a rendered accessor rather than composing it, because the package's own composition is what keeps the surrounding prose coherent.

`mechanics` and `header` affect the rendered form only. The raw template is what a topic contains before any option is applied, so it carries the placeholders unconditionally.

Both SHALL throw on a topic with no embedded recipe, matching `getPrompt`. The existing internal `getRecipe` accessor SHALL continue to return `undefined` for an unknown topic; the `agent` command distinguishes an unknown topic from a failure and cannot use a throwing accessor.

`variables` SHALL be identical between the two functions for the same topic, since both describe the same template.

#### Scenario: Rendered instructions match the existing accessor

- **WHEN** a consumer calls `getInstructions(t)` and `getPrompt(t)` for the same topic and options
- **THEN** `getInstructions(t).text` SHALL equal `getPrompt(t)`

#### Scenario: Raw instructions are re-renderable

- **WHEN** a consumer renders `getRawInstructions(t).text` with sprintf-js against the same variable values the package used
- **THEN** the result SHALL equal `getInstructions(t).text`

#### Scenario: An unknown topic throws

- **WHEN** either accessor is called with a topic that has no embedded recipe
- **THEN** it SHALL throw, rather than returning an empty or undefined result

#### Scenario: A package-composed variable is not a host-fillable one

- **WHEN** a consumer reads `variables` from a raw accessor
- **THEN** the list SHALL include names the package resolves itself, which a host cannot supply a correct value for

### Requirement: The variable list is derived from the template parser

The `variables` list SHALL be obtained from `sprintf-js`'s own parse of the template, by rendering it against a value source that records which names are requested. It SHALL NOT be reconstructed by pattern-matching the template text.

The recorded pass's rendered output SHALL be discarded. `sprintf-js` collapses an escaped `%%` to a literal `%` while parsing, so text that has been through it is no longer a valid template — `getRawInstructions().text` SHALL therefore be the source template verbatim, never the recording pass's output.

#### Scenario: Escaped percent signs survive in raw text

- **WHEN** a topic whose template contains `%%` is requested via `getRawInstructions`
- **THEN** the returned text SHALL still contain `%%`, and rendering it SHALL yield a single `%`

#### Scenario: Variables are reported without a regex

- **WHEN** the variable list for a topic is computed
- **THEN** it SHALL come from the templating library's parse, so a name the library resolves is reported and text that merely resembles a placeholder is not

### Requirement: The host-bound steps are suppressible

`PromptOptions` SHALL accept `mechanics`, defaulting to `true`. When `false`, a recipe's steps that gather evidence by running this CLI SHALL render as a statement of what the caller supplies instead of as a command to run.

The substitution SHALL include the connective the step's own prose continues from, so the step reads as a sentence in both modes. Replacing only the command leaves the prose depending on a clause that is no longer there.

The evidence SHALL NOT be dropped along with the command. A recipe's criteria are stated in terms of what those steps gather, so a consumer told only that the step does not apply loses the inputs rather than the commands.

**Rationale.** `invocation` cannot serve this. It substitutes the launcher inside a command, so a consumer with no CLI that sets it to a phrase renders an instruction to execute something that does not parse — a malformed rendering, which is worse than either honest answer.

#### Scenario: The default renders the command

- **WHEN** a consumer calls `getPrompt(t)` for a topic with host-bound steps
- **THEN** the step SHALL render the command to run, unchanged from what the `agent` command prints

#### Scenario: Suppressing them names what the caller supplies

- **WHEN** a consumer calls `getPrompt(t, { mechanics: false })`
- **THEN** no command to run SHALL appear in those steps
- **AND** the step SHALL name the evidence the caller is expected to provide
- **AND** the surrounding prose SHALL remain grammatical
