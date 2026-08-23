## ADDED Requirements

### Requirement: The export provides rendered and raw instruction accessors

The export SHALL provide `getInstructions(topic, options?)` and `getRawInstructions(topic, options?)`, each returning `{ text: string; variables: string[] }`.

`getInstructions` SHALL return finished text — the same string `getPrompt` returns for the same topic and options — alongside the names of the sprintf variables the topic's template contains. `getRawInstructions` SHALL return the **unrendered** template text alongside the same variable names, so a host that knows a value the package cannot know can render it itself.

Both SHALL throw on a topic with no embedded recipe, matching `getPrompt`. The existing internal `getRecipe` accessor SHALL continue to return `undefined` for an unknown topic; the `agent` command distinguishes an unknown topic from a failure and cannot use a throwing accessor.

`variables` SHALL be identical between the two functions for the same topic and options, since both describe the same template.

`variables` SHALL describe the `text` that accessor returns. When `header: false` drops the header line, variables that appear only in that line (every recipe header carries `%(CLI_VERSION)s`) SHALL NOT be reported.

#### Scenario: Rendered instructions match the existing accessor

- **WHEN** a consumer calls `getInstructions(t)` and `getPrompt(t)` for the same topic and options
- **THEN** `getInstructions(t).text` SHALL equal `getPrompt(t)`

#### Scenario: Raw instructions are re-renderable

- **WHEN** a consumer renders `getRawInstructions(t).text` with sprintf-js against the same variable values the package used
- **THEN** the result SHALL equal `getInstructions(t).text`

#### Scenario: A header-less accessor does not report header-only variables

- **WHEN** a consumer calls either accessor with `{ header: false }` for a topic whose only `%(CLI_VERSION)s` placeholder is in the header line
- **THEN** `variables` SHALL NOT contain `CLI_VERSION`

#### Scenario: An unknown topic throws

- **WHEN** either accessor is called with a topic that has no embedded recipe
- **THEN** it SHALL throw, rather than returning an empty or undefined result

### Requirement: The variable list is derived from the template parser

The `variables` list SHALL be obtained from `sprintf-js`'s own parse of the template, by rendering it against a value source that records which names are requested. It SHALL NOT be reconstructed by pattern-matching the template text.

The recorded pass's rendered output SHALL be discarded. `sprintf-js` collapses an escaped `%%` to a literal `%` while parsing, so text that has been through it is no longer a valid template — `getRawInstructions().text` SHALL therefore be the source template verbatim, never the recording pass's output.

#### Scenario: Escaped percent signs survive in raw text

- **WHEN** a topic whose template contains `%%` is requested via `getRawInstructions`
- **THEN** the returned text SHALL still contain `%%`, and rendering it SHALL yield a single `%`

#### Scenario: Variables are reported without a regex

- **WHEN** the variable list for a topic is computed
- **THEN** it SHALL come from the templating library's parse, so a name the library resolves is reported and text that merely resembles a placeholder is not

## MODIFIED Requirements

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
