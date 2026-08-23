## MODIFIED Requirements

### Requirement: Recipe substitution uses sprintf-js named arguments

Recipe rendering SHALL substitute placeholders via `sprintf-js` using its named-argument form (`%(KEY)s`). The renderer SHALL build a variables table for each render call containing two flavors of substitution:

1. **System-resolved values** — keys whose values come from runtime state. The renderer SHALL provide `CLI_VERSION` (resolved from the build-time version constant) for every render. The renderer SHALL provide `INPUT_SCHEMA` only when the recipe content contains the `%(INPUT_SCHEMA)s` placeholder; the value is the JSON Schema rendered from the topic's Zod schema in `packages/cli/src/schemas/`, or the literal string `"(no input schema for this topic)"` when no Zod schema is registered for the topic.
2. **Agent-fill markers** — keys whose values render as a lowercase angle-bracket token of the same name (e.g. `PACKAGE_MANAGER_DLX` renders as `<package-manager-dlx>`). The renderer SHALL provide `PACKAGE_MANAGER_DLX` for every render. Agent-fill markers exist so the consuming agent can substitute the value at execution time without the recipe having to invent a per-recipe placeholder convention.

The renderer SHALL additionally provide `TASKLESS_CLI` for every render. It is a hybrid of the two flavors: system-resolved when the caller or the build knows the answer, and an agent-fill marker when neither does. It SHALL resolve in this order:

1. The caller-supplied invocation, when one is given.
2. The build-target invocation, when the build target is not prod — a `nightly`, `dev`, or `self` build knows exactly what it is and SHALL name itself.
3. Otherwise the agent-fill marker `<taskless-cli>`.

Step 3 SHALL NOT fall back to `npx @taskless/cli`. A prod build that does not know how it was launched has no basis for naming one launcher over another, and a marker asks the reading agent for the answer instead of asserting a wrong one.

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

- **WHEN** any `<topic>.txt` file under `packages/cli/src/agent/` is read
- **THEN** it SHALL NOT contain a `{{KEY}}` mustache-style placeholder
- **AND** all substitution SHALL be expressed as `%(KEY)s` sprintf-js named arguments

## ADDED Requirements

### Requirement: Recipes name the CLI by its full invocation

Every instruction in shipped agent-facing content that tells a reader to run the Taskless CLI SHALL express the CLI as `%(TASKLESS_CLI)s`, followed by the subcommand and its arguments. This applies to the recipe sources under `packages/cli/src/agent/`, to `skills/taskless/SKILL.md`, and to `commands/tskl/tskl.md`.

Content SHALL NOT name the CLI as a bare `taskless` binary, because it is not installed on `PATH` for the overwhelming majority of readers, and SHALL NOT hardcode a launcher-and-package string such as `npx @taskless/cli`, because that is the fact `%(TASKLESS_CLI)s` exists to hold in one place. Prose that mentions the product, a config filename, or a directory (`taskless.config`, `.taskless/`) is unaffected — the requirement is about executable instructions.

An automated check SHALL fail when a bare `` `taskless <subcommand>` `` invocation appears in a recipe source, so the normalization cannot silently regress as recipes are edited.

#### Scenario: A recipe instructs the reader to run a subcommand

- **WHEN** a recipe tells the reader to fetch another topic
- **THEN** the source SHALL read `%(TASKLESS_CLI)s agent <topic>` rather than `taskless agent <topic>` or `npx @taskless/cli agent <topic>`

#### Scenario: A regression is reintroduced

- **WHEN** a recipe source is edited to contain a bare `` `taskless check` ``-style invocation
- **THEN** the automated check SHALL fail and name the offending file and line

#### Scenario: Non-prod builds rewrite every invocation, not some of them

- **WHEN** a `nightly` or `self` build renders any recipe
- **THEN** every CLI invocation in the rendered text SHALL name that build's own invocation, with no occurrence left naming the released `@taskless/cli`

#### Scenario: Cross-reference checking survives the normalization

- **WHEN** the check that recipe cross-references cite only topics that resolve is run
- **THEN** it SHALL operate on rendered recipe text, where the invocation is a stable literal, rather than on source text where it is a placeholder
