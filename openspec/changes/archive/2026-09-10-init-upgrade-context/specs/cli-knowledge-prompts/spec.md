## MODIFIED Requirements

### Requirement: The version header is suppressible

Rendered prompts SHALL begin with a header block: a line naming the topic and the CLI version, then the fetch-time directive line, then one blank line. Because that version participates in an LLM consumer's prompt-cache key, `PromptOptions.header` SHALL allow suppressing the block. It SHALL default to `true`, leaving the `agent` command's output and all existing behavior unchanged. Suppression SHALL remove the whole block, so a header-less rendering neither carries the version nor opens with a directive that only makes sense beside it.

#### Scenario: Header suppressed for a cache-stable system prompt

- **WHEN** a consumer calls a prompt with `header: false`
- **THEN** the returned text omits the `# Topic: …` line and the directive line and contains no CLI version string, while the body is otherwise identical to the default rendering

#### Scenario: Header present by default

- **WHEN** a prompt is called with no options, or the `agent` command renders a topic
- **THEN** the header block is present, exactly as it renders today

#### Scenario: Build defines are inlined into the prompts entry

- **WHEN** a rendered prompt is inspected from the built `dist/prompts.js`
- **THEN** it contains no un-inlined build-define identifier (e.g. a literal `__VERSION__`)
