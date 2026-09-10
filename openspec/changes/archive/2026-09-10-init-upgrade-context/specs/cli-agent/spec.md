## MODIFIED Requirements

### Requirement: Recipe files follow a consistent format

Every recipe file at `packages/cli/src/agent/<topic>.md` SHALL follow the canonical recipe template: a header block, followed by `## Goal`, `## Preconditions`, `## Steps`, optional `## Input schema` (for recipes that take `--from`), `## Errors`, and `## See Also` sections in that order.

The header block SHALL be exactly two lines followed by one blank line. The first line SHALL be `# Topic: <name>     (CLI v%(CLI_VERSION)s / topic v<n>)`. The second line SHALL be the fetch-time directive, identical across every recipe: it states that the text was resolved by the CLI at the moment it was fetched and that a later task, in the same session or another, fetches it again with `%(TASKLESS_CLI)s agent <topic>` rather than reusing this copy. The directive is part of the header so that a cache-stable rendering can drop it together with the version line.

Recipe templates SHALL use sprintf-js `%(KEY)s` named-argument placeholders for all substitution. The header SHALL embed `%(CLI_VERSION)s` for the CLI version. Topics that document a `--from` input SHALL embed `%(INPUT_SCHEMA)s` inside the `## Input schema` fenced code block. The topic version integer in the header SHALL be a literal value maintained by the recipe author and bumped when the recipe changes meaningfully.

#### Scenario: Recipe contains all template sections

- **WHEN** any `<topic>.md` file is read
- **THEN** it SHALL begin with a `# Topic:` header containing `%(CLI_VERSION)s` and the topic version integer
- **AND** SHALL contain `## Goal`, `## Preconditions`, `## Steps`, `## Errors`, and `## See Also` sections in that order

#### Scenario: Every recipe carries the fetch-time directive as its second line

- **WHEN** any `<topic>.md` file is read
- **THEN** its second line SHALL be the fetch-time directive, byte-identical to the directive in every other recipe
- **AND** the third line SHALL be blank

#### Scenario: Recipe with --from input includes JSON schema placeholder

- **WHEN** a topic recipe documents a CLI invocation that uses `--from <file>`
- **THEN** the recipe SHALL contain an `## Input schema` section with a code-fenced block containing the `%(INPUT_SCHEMA)s` placeholder
- **AND** the JSON Schema SHALL be derived at render time from the corresponding Zod schema in `packages/cli/src/schemas/`

#### Scenario: Header version reflects build-time CLI version

- **WHEN** the CLI bundle is built
- **THEN** the recipe header's `%(CLI_VERSION)s` placeholder SHALL be substituted at render time from `packages/cli/package.json`
- **AND** SHALL match the version reported by `taskless info`
