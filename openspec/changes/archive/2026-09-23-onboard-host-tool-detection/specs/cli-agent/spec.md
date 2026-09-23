## MODIFIED Requirements

### Requirement: Recipe substitution uses sprintf-js named arguments

Recipe rendering SHALL substitute placeholders via `sprintf-js` using its named-argument form (`%(KEY)s`). The renderer SHALL build a variables table for each render call containing three flavors of substitution:

1. **System-resolved values** — keys whose values come from runtime state. The renderer SHALL provide `CLI_VERSION` (resolved from the build-time version constant) for every render. The renderer SHALL provide `INPUT_SCHEMA` only when the recipe content contains the `%(INPUT_SCHEMA)s` placeholder; the value is the JSON Schema rendered from the topic's Zod schema in `packages/cli/src/schemas/`, or the literal string `"(no input schema for this topic)"` when no Zod schema is registered for the topic.
2. **Agent-fill markers** — keys whose values render as a lowercase angle-bracket token of the same name (e.g. `PACKAGE_MANAGER_DLX` renders as `<package-manager-dlx>`). The renderer SHALL provide `PACKAGE_MANAGER_DLX` for every render. Agent-fill markers exist so the consuming agent can substitute the value at execution time without the recipe having to invent a per-recipe placeholder convention.
3. **Conditional blocks** — keys whose value is one of a fixed set of whole passages, selected by state the caller passes in. A conditional block SHALL span an entire syntactic unit of the surrounding markdown — a whole list item, a whole numbered step — and SHALL include the grammatical connective the neighbouring prose continues from. The renderer SHALL NOT remove or rewrite text after rendering to achieve a conditional effect: a post-render strip cannot promise that the unconditioned rendering is byte-for-byte what it was, and it leaves the prose depending on a clause that is no longer present. Every conditional block SHALL have a default passage used when the caller supplies no state, and that default SHALL be the unconditioned text a consumer with no host — the `@taskless/cli/prompts` export among them — receives.

The renderer SHALL additionally provide `TASKLESS_CLI` for every render. It is a hybrid of the first two flavors: system-resolved when the caller or the build knows the answer, and an agent-fill marker when neither does. It SHALL resolve in this order:

1. The caller-supplied invocation, when one is given.
2. The build-target invocation, when the build target is not prod — a `nightly`, `dev`, or `self` build knows exactly what it is and SHALL name itself.
3. Otherwise the agent-fill marker `<taskless-cli>`.

Step 3 SHALL NOT fall back to `npx @taskless/cli`. A prod build that does not know how it was launched has no basis for naming one launcher over another, and a marker asks the reading agent for the answer instead of asserting a wrong one.

No flavor SHALL read ambient host state. The render path is imported by Workers without `nodejs_compat`, so a value that can only be learned from `process`, the environment, `argv`, the filesystem, or `PATH` SHALL be detected in the CLI and passed in as a render option.

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

#### Scenario: A conditional block renders its default with no caller state

- **WHEN** a recipe containing a conditional block is rendered with no state supplied for it
- **THEN** the block SHALL render its default passage
- **AND** the surrounding markdown SHALL remain well-formed

#### Scenario: A conditional block replaces a whole unit

- **WHEN** a conditional block selects a passage other than its default
- **THEN** the replaced region SHALL be a whole list item or a whole numbered step, connective included
- **AND** no text SHALL be removed from the rendered output after substitution

#### Scenario: TASKLESS_CLI renders a caller-supplied invocation

- **WHEN** a recipe containing `%(TASKLESS_CLI)s` is rendered with an explicit invocation
- **THEN** every occurrence SHALL render as that invocation

#### Scenario: TASKLESS_CLI names a non-prod build target

- **WHEN** a recipe containing `%(TASKLESS_CLI)s` is rendered with no explicit invocation from a `nightly`, `dev`, or `self` build
- **THEN** every occurrence SHALL render as that build's own invocation, so a nightly names `@taskless/cli-nightly` at its published version rather than the released package

#### Scenario: TASKLESS_CLI falls back to an agent-fill marker

- **WHEN** a recipe containing `%(TASKLESS_CLI)s` is rendered from a prod build with no explicit invocation
- **THEN** every occurrence SHALL render as the literal token `<taskless-cli>`
- **AND** SHALL NOT render as `npx @taskless/cli` or any other guessed launcher

#### Scenario: No legacy placeholder syntax remains in recipes

- **WHEN** any `<topic>.md` file under `packages/cli/src/agent/` is read
- **THEN** it SHALL NOT contain a `{{KEY}}` mustache-style placeholder
- **AND** all substitution SHALL be expressed as `%(KEY)s` sprintf-js named arguments
