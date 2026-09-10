## ADDED Requirements

### Requirement: The agent subcommand serves each recipe under a fetch-time header

When `taskless agent <topic>` serves a recipe, the rendered text SHALL carry a fetch-time directive as the second line of its header block, directly beneath the `# Topic:` line and before the blank line that closes the block. The directive SHALL state that the CLI resolved the text at the moment it was fetched, that the next Taskless task fetches it again with `<invocation> agent <topic>` rather than reusing this copy, and that a session in which Taskless was installed or upgraded holds a stale skill until it is reloaded. It SHALL be identical for every topic except for the rendered invocation.

The directive is added by the renderer on the `agent` command's request, not written into the recipe files. A recipe file SHALL keep its single-line `# Topic:` header, and a prompt rendered through `@taskless/cli/prompts` SHALL NOT carry the directive: that export exists for a consumer embedding the text in its own prompt, where an instruction to re-run a CLI may be false. `PromptOptions.header: false` SHALL strip the whole header block, directive included, whenever one is present.

#### Scenario: A served recipe opens with the directive

- **WHEN** `taskless agent check` is run
- **THEN** line 1 of stdout SHALL be the `# Topic: check …` header
- **AND** line 2 SHALL be the fetch-time directive, naming the invocation and `agent <topic>`
- **AND** line 3 SHALL be blank, followed by the recipe body unchanged

#### Scenario: The prompts export does not carry the directive

- **WHEN** a consumer renders any topic through `@taskless/cli/prompts` with default options
- **THEN** the text SHALL begin with the `# Topic:` line followed directly by a blank line
- **AND** SHALL NOT contain the directive

#### Scenario: Header suppression removes the directive with the version

- **WHEN** a recipe is rendered with the directive and `header: false`
- **THEN** the result SHALL contain neither the `# Topic:` line, the CLI version, nor the directive
- **AND** its body SHALL be byte-identical to the body of the default rendering
