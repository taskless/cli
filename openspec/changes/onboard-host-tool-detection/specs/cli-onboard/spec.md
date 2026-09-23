## REMOVED Requirements

### Requirement: Onboard recipe is embedded from help/onboard.txt

**Reason**: The requirement's title names a file that no longer exists. The recipe has been `packages/cli/src/agent/onboard.md` since the Vale-coverage change gave the recipes a markdown extension, and `help/` has not been the directory for longer than that. A requirement title is matched byte-for-byte by the archive step, so a title cannot be corrected by a MODIFIED block — a renamed title applies nothing at all and reports no error. It is therefore removed and re-added under its correct name.

**Migration**: None. The replacement requirement below states the same obligation over the file's real path; no behavior changes and no consumer acts on the title.

## ADDED Requirements

### Requirement: Onboard recipe is embedded from agent/onboard.md

The CLI build SHALL embed `packages/cli/src/agent/onboard.md` into the bundle via the same `import.meta.glob` mechanism used for other agent topics. The `taskless onboard` subcommand SHALL read the recipe content from the embedded bundle, not from the filesystem at runtime. The embedded recipe SHALL be the same content returned by `taskless agent onboard`.

Both serving paths SHALL resolve every render option identically, the detected host-tool state included. `taskless onboard` is not a topic that `agent` dispatches, so each path detects independently; a state one path computes and the other does not SHALL be treated as a defect in this requirement rather than as a difference between the two commands.

#### Scenario: Recipe is available without filesystem access

- **WHEN** a user runs `taskless onboard` via `npx @taskless/cli`
- **THEN** the recipe content SHALL be served from the embedded bundle
- **AND** SHALL NOT require any filesystem reads under `packages/cli/src/agent/`

#### Scenario: Onboard and agent return the same recipe

- **WHEN** a user runs `taskless onboard --force` (recipe path)
- **AND** a user runs `taskless agent onboard`
- **THEN** the printed recipe content SHALL be identical between the two invocations

#### Scenario: The two paths agree in every host-tool state

- **WHEN** `taskless onboard --force` and `taskless agent onboard` are run in the same working directory, on the same host
- **THEN** the printed recipe content SHALL be identical, whichever tools are present and whether or not the repository has a GitHub `origin`

## MODIFIED Requirements

### Requirement: Onboard gates on the onboarded manifest field

When invoked without `--mark-complete`, the `taskless onboard` subcommand SHALL read `.taskless/taskless.json` and inspect the optional `install.onboarded` field. If the field equals `true` AND `--force` is not set, the subcommand SHALL print a short message stating the user is already onboarded and that `--force` re-runs the recipe, then exit with code 0 without printing the recipe. If the field is absent, `false`, or `--force` is set, the subcommand SHALL print the recipe content embedded from `packages/cli/src/agent/onboard.md` to stdout and exit with code 0.

#### Scenario: Already onboarded without --force prints a short notice

- **WHEN** `.taskless/taskless.json` contains `install.onboarded: true`
- **AND** a user runs `taskless onboard` (no `--force`)
- **THEN** the command SHALL print a short message indicating onboarding is already complete
- **AND** SHALL mention that `--force` re-runs the recipe
- **AND** SHALL exit with code 0
- **AND** SHALL NOT print the recipe body

#### Scenario: Already onboarded with --force prints the recipe

- **WHEN** `.taskless/taskless.json` contains `install.onboarded: true`
- **AND** a user runs `taskless onboard --force`
- **THEN** the command SHALL print the recipe content from `onboard.md`
- **AND** SHALL exit with code 0

#### Scenario: Onboarded field absent prints the recipe

- **WHEN** `.taskless/taskless.json` does not contain an `install.onboarded` field
- **AND** a user runs `taskless onboard`
- **THEN** the command SHALL print the recipe content from `onboard.md`
- **AND** SHALL exit with code 0

#### Scenario: Onboarded field is false prints the recipe

- **WHEN** `.taskless/taskless.json` contains `install.onboarded: false`
- **AND** a user runs `taskless onboard`
- **THEN** the command SHALL print the recipe content from `onboard.md`
- **AND** SHALL exit with code 0

### Requirement: Onboard recipe follows the canonical recipe template and is conversational

The `onboard.md` file SHALL follow the canonical recipe template defined in the `cli-agent` capability (header with CLI version + topic version, `## Goal`, `## Preconditions`, `## Steps`, `## Errors`, `## See Also`). The `## Steps` section SHALL describe a conversational discovery flow rather than a fixed sequence. Specifically, the recipe SHALL instruct the agent to:

1. Read `.taskless/taskless.json` and respect the `install.onboarded` field.
2. Establish the routing surface before proposing any candidate, by fetching the `route` topic for the destination criterion and running `taskless detect --json` for the repository's linters, languages, and rule styles.
3. Open the conversation with a short menu of known sources for rule candidates: codebase TODOs/FIXMEs (via ripgrep or built-in search), agent-memory files (CLAUDE.md, AGENTS.md, .cursorrules, etc.), recent PR review comments, and bug-tracker tickets.
4. Encourage the user to suggest additional sources the agent may not know about.
5. Report the command-line tools the CLI already found, rather than instruct the agent to probe for them. The recipe SHALL NOT instruct the agent to run `command -v` or any equivalent probe for a tool the CLI reports on.
6. For each chosen source, scan and filter for high-signal candidates: repeated patterns across multiple PRs/files/comments, comments that cite a doc or style guide, and merge-blocking review feedback. Filter out one-off nits and pure formatting feedback.
7. Synthesize a single bullet list where each bullet is a hypothetical rule expressed as `<kebab-case-name> [<destination>]: <one-line description of what it would enforce>`.
8. For each bullet, offer to materialize it by following the `route` topic, with the accepted bullet as the rule description input.
9. At the end, ask the user whether they consider onboarding complete; on explicit yes, run `taskless onboard --mark-complete`.

The recipe SHALL describe a detected tool as present, never as verified. The CLI establishes presence by looking for a file on `PATH` and executes nothing, so the recipe SHALL say so — "`gh` is on your PATH; Taskless did not run it" — and SHALL NOT assert that a tool works, is a particular version, or is genuine.

The recipe SHALL NOT name one bug tracker as the expected one. It MAY name trackers such as Jira and Linear as examples of the class. Whether a tracker is reachable depends on the agent's MCP roster, which the CLI cannot see, so the recipe SHALL leave that judgement to the agent at runtime and SHALL condition the source on a relevant MCP being available rather than on any named vendor.

When a source is not offered, the recipe SHALL say in one line why it is not offered. A reader who is not told reads the omission as an oversight and asks for it, which costs a turn and ends where the recipe already is. Where a source is unavailable for more than one reason, the reason that cannot be remedied SHALL be the one stated: a repository with no GitHub `origin` SHALL be told there are no pull requests to mine, not that `gh` is missing, and SHALL NOT be offered PR-comment mining even when `gh` is present.

The recipe SHALL NOT restate the destination criterion itself. That comparison is defined once, in the `route` topic, and the recipe SHALL reference it rather than duplicate it.

The recipe SHALL warn the agent against marking onboarding complete without explicit user confirmation.

#### Scenario: Recipe header includes CLI and topic version

- **WHEN** `onboard.md` is read
- **THEN** the first line SHALL match the canonical header format `# Topic: onboard     (CLI v<x.y.z> / topic v<n>)`

#### Scenario: Recipe establishes the routing surface before proposing candidates

- **WHEN** the recipe `## Steps` section is read
- **THEN** a step instructing the agent to fetch the `route` topic and to run `detect --json` SHALL appear before the step that synthesizes the bullet list

#### Scenario: Recipe does not duplicate the destination criterion

- **WHEN** `onboard.md` is read
- **THEN** it SHALL NOT contain a table or enumeration comparing the rule destinations against one another
- **AND** it SHALL direct the agent to the `route` topic for that comparison

#### Scenario: Recipe enumerates the known source menu

- **WHEN** the recipe `## Steps` section is read with no host-tool state supplied
- **THEN** it SHALL list at least: codebase TODOs/FIXMEs, agent-memory files, PR review comments, and bug-tracker tickets
- **AND** it SHALL NOT instruct the agent to probe for `gh`

#### Scenario: A present and applicable tool is offered as present

- **WHEN** the recipe is rendered for a GitHub repository on a host where `gh` is on `PATH`
- **THEN** the PR-review source SHALL be offered
- **AND** the text SHALL state that `gh` is on the PATH and that Taskless did not run it

#### Scenario: An absent tool is omitted with its reason

- **WHEN** the recipe is rendered for a GitHub repository on a host where `gh` is not on `PATH`
- **THEN** the PR-review source SHALL NOT be offered
- **AND** the recipe SHALL state in one line that `gh` was not found on the PATH

#### Scenario: A repository with no GitHub origin is told the source does not apply

- **WHEN** the recipe is rendered for a repository whose `ghOwner` resolves to `[unknown]`, whether or not `gh` is on `PATH`
- **THEN** the PR-review source SHALL NOT be offered
- **AND** the stated reason SHALL be that the repository has no GitHub origin, not that `gh` is missing

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
