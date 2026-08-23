## MODIFIED Requirements

### Requirement: Onboard recipe follows the canonical recipe template and is conversational

The `onboard.txt` file SHALL follow the canonical recipe template defined in the `cli-agent` capability (header with CLI version + topic version, `## Goal`, `## Preconditions`, `## Steps`, `## Errors`, `## See Also`). The `## Steps` section SHALL describe a conversational discovery flow rather than a fixed sequence. Specifically, the recipe SHALL instruct the agent to:

1. Read `.taskless/taskless.json` and respect the `install.onboarded` field.
2. Establish the routing surface before proposing any candidate, by fetching the `route` topic for the destination criterion and running `taskless detect --json` for the repository's linters, languages, and rule styles.
3. Open the conversation with a short menu of known sources for rule candidates: codebase TODOs/FIXMEs (via ripgrep or built-in search), agent-memory files (CLAUDE.md, AGENTS.md, .cursorrules, etc.), recent PR review comments (when `gh` is available), and issue-tracker tickets (when a relevant MCP is detected).
4. Encourage the user to suggest additional sources the agent may not know about.
5. Probe for tool availability before promising scans (e.g., check `command -v gh`, inspect available MCP tools).
6. For each chosen source, scan and filter for high-signal candidates: repeated patterns across multiple PRs/files/comments, comments that cite a doc or style guide, and merge-blocking review feedback. Filter out one-off nits and pure formatting feedback.
7. Synthesize a single bullet list where each bullet is a hypothetical rule expressed as `<kebab-case-name> [<destination>]: <one-line description of what it would enforce>`.
8. For each bullet, offer to materialize it by following the `route` topic, with the accepted bullet as the rule description input.
9. At the end, ask the user whether they consider onboarding complete; on explicit yes, run `taskless onboard --mark-complete`.

The recipe SHALL NOT restate the destination criterion itself. That comparison is defined once, in the `route` topic, and the recipe SHALL reference it rather than duplicate it.

The recipe SHALL warn the agent against marking onboarding complete without explicit user confirmation.

#### Scenario: Recipe header includes CLI and topic version

- **WHEN** `onboard.txt` is read
- **THEN** the first line SHALL match the canonical header format `# Topic: onboard     (CLI v<x.y.z> / topic v<n>)`

#### Scenario: Recipe establishes the routing surface before proposing candidates

- **WHEN** the recipe `## Steps` section is read
- **THEN** a step instructing the agent to fetch the `route` topic and to run `detect --json` SHALL appear before the step that synthesizes the bullet list

#### Scenario: Recipe does not duplicate the destination criterion

- **WHEN** `onboard.txt` is read
- **THEN** it SHALL NOT contain a table or enumeration comparing the rule destinations against one another
- **AND** it SHALL direct the agent to the `route` topic for that comparison

#### Scenario: Recipe enumerates the known source menu

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL list at least: codebase TODOs/FIXMEs, agent-memory files, PR review comments (with `gh`), and issue-tracker tickets (with MCP)

#### Scenario: Recipe encourages user-suggested sources

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL explicitly instruct the agent to ask the user whether other sources should be scanned

#### Scenario: Recipe specifies the annotated bullet output shape

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL describe the rule-candidate output as a bullet list with `<kebab-case-name> [<destination>]: <description>` per item
- **AND** SHALL state that the annotation is provisional and that the `route` topic decides the destination at materialization time

#### Scenario: Recipe gates --mark-complete on user confirmation

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL instruct the agent to ask for explicit user confirmation before invoking `taskless onboard --mark-complete`
- **AND** SHALL warn that the agent must NOT mark onboarding complete without that confirmation

#### Scenario: Recipe references the rule-authoring route topic in See Also

- **WHEN** the `## See Also` section is read
- **THEN** it SHALL include a reference to `taskless agent route`
