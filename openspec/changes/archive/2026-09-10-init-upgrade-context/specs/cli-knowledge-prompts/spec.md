## MODIFIED Requirements

### Requirement: The export and the agent command share one source and one renderer

The prompt export SHALL be sourced from the same embedded `agent/*.md` content that `commands/agent.ts` serves, and SHALL render it through the same render path, with no duplicated embedding and no duplicated interpolation logic. Both surfaces SHALL return identical text for the same topic and equivalent options. The one option the `agent` command sets that the export does not default to is `directive`: the command serves a fetch, so it asks for the fetch-time directive, and the export leaves it off. A consumer that passes `directive: true` SHALL receive exactly what the command prints.

#### Scenario: Parity between import and agent command

- **WHEN** the `agent` command renders topic `T` and a consumer calls `getPrompt("T", { directive: true })`
- **THEN** the two texts are identical, including under a non-prod build target where the CLI invocation is rewritten
- **AND** `getPrompt("T")` with default options is the same text without the directive line
