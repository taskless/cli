# cli-onboard Specification

## Purpose

Defines the `taskless onboard` subcommand: the post-install discovery flow that helps a fresh user go from zero rules to a useful starter set. Unlike `taskless init` (which is fast, deterministic, and gets the user _installed_), `onboard` delivers a conversational agent recipe that mines the codebase, agent-memory files, and (when available) PR review comments and issue tracker tickets for high-signal rule candidates, then surfaces them as a bullet list the user materializes via `taskless rule create`.

This capability covers:

- **Subcommand surface**: three modes via flag combinations — default prints the recipe (refused when already complete), `--force` re-runs regardless of state, `--mark-complete` writes `install.onboarded: true`. `--force` and `--mark-complete` are mutually exclusive.
- **Manifest gating and writes**: the optional 3-state `install.onboarded` field on `.taskless/taskless.json` (absent / `false` / `true`) is the single source of truth for whether onboarding is complete. Only this subcommand writes the field, and only via `--mark-complete`. The agent invokes `--mark-complete` only after explicit user confirmation per the recipe.
- **Recipe embedding**: the recipe lives at `packages/cli/src/agent/onboard.txt`, embedded into the CLI bundle at build time and rendered via the same sprintf-js path the `agent` command uses (`taskless agent onboard` returns the same content as `taskless onboard --force`).
- **Telemetry**: emits `cli_onboard_recipe` (with a `forced` property), `cli_onboard_already_done`, and `cli_onboard_marked_complete` PostHog events on the appropriate code paths.

## Requirements

### Requirement: Onboard subcommand exists with --force and --mark-complete flags

The CLI SHALL support a `taskless onboard` subcommand. The subcommand SHALL accept the global `-d` working-directory flag, a `--force` boolean flag (default `false`), and a `--mark-complete` boolean flag (default `false`). `--force` and `--mark-complete` SHALL be mutually exclusive; supplying both SHALL exit with code 1 and a clear error message. The subcommand SHALL bootstrap the `.taskless/` directory via `ensureTasklessDirectory()` before reading or writing manifest state.

#### Scenario: Onboard command is registered

- **WHEN** a user runs `taskless --help`
- **THEN** `onboard` SHALL appear in the list of available subcommands
- **AND** the description SHALL describe it as the post-install discovery flow

#### Scenario: Onboard accepts --force

- **WHEN** a user runs `taskless onboard --force`
- **THEN** the command SHALL accept the flag without error

#### Scenario: Onboard accepts --mark-complete

- **WHEN** a user (or agent) runs `taskless onboard --mark-complete`
- **THEN** the command SHALL accept the flag without error

#### Scenario: --force and --mark-complete are mutually exclusive

- **WHEN** a user runs `taskless onboard --force --mark-complete`
- **THEN** the command SHALL exit with code 1
- **AND** SHALL print an error message stating that the two flags cannot be combined

#### Scenario: Onboard respects the global -d flag

- **WHEN** a user runs `taskless onboard -d /path/to/repo`
- **THEN** all manifest reads and writes SHALL operate on `/path/to/repo/.taskless/taskless.json`

### Requirement: Onboard gates on the onboarded manifest field

When invoked without `--mark-complete`, the `taskless onboard` subcommand SHALL read `.taskless/taskless.json` and inspect the optional `install.onboarded` field. If the field equals `true` AND `--force` is not set, the subcommand SHALL print a short message stating the user is already onboarded and that `--force` re-runs the recipe, then exit with code 0 without printing the recipe. If the field is absent, `false`, or `--force` is set, the subcommand SHALL print the recipe content embedded from `packages/cli/src/agent/onboard.txt` to stdout and exit with code 0.

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
- **THEN** the command SHALL print the recipe content from `onboard.txt`
- **AND** SHALL exit with code 0

#### Scenario: Onboarded field absent prints the recipe

- **WHEN** `.taskless/taskless.json` does not contain an `install.onboarded` field
- **AND** a user runs `taskless onboard`
- **THEN** the command SHALL print the recipe content from `onboard.txt`
- **AND** SHALL exit with code 0

#### Scenario: Onboarded field is false prints the recipe

- **WHEN** `.taskless/taskless.json` contains `install.onboarded: false`
- **AND** a user runs `taskless onboard`
- **THEN** the command SHALL print the recipe content from `onboard.txt`
- **AND** SHALL exit with code 0

### Requirement: --mark-complete writes onboarded:true to the manifest

When invoked with `--mark-complete`, the `taskless onboard` subcommand SHALL write `install.onboarded: true` into `.taskless/taskless.json` and exit with code 0. The write SHALL be idempotent: invoking with `--mark-complete` when the field is already `true` SHALL succeed without error and without modifying other manifest fields. The write SHALL preserve all other manifest fields (including unknown fields and the existing `install` sub-object structure) on round-trip. The subcommand SHALL print a one-line confirmation to stdout indicating the manifest was updated.

#### Scenario: Mark-complete writes the field on a fresh manifest

- **WHEN** `.taskless/taskless.json` does not contain `install.onboarded`
- **AND** a user (or agent) runs `taskless onboard --mark-complete`
- **THEN** `install.onboarded` SHALL be `true` after the command completes
- **AND** the command SHALL print a confirmation
- **AND** SHALL exit with code 0

#### Scenario: Mark-complete is idempotent

- **WHEN** `.taskless/taskless.json` already contains `install.onboarded: true`
- **AND** a user runs `taskless onboard --mark-complete`
- **THEN** the command SHALL succeed without error
- **AND** SHALL exit with code 0
- **AND** SHALL NOT modify other manifest fields

#### Scenario: Mark-complete preserves other install fields

- **WHEN** `.taskless/taskless.json` contains an existing `install.targets` map with skills and commands
- **AND** a user runs `taskless onboard --mark-complete`
- **THEN** the existing `install.targets` map SHALL be preserved verbatim
- **AND** `install.onboarded` SHALL be added or set to `true`

#### Scenario: Mark-complete preserves unknown top-level fields

- **WHEN** `.taskless/taskless.json` contains an unknown top-level field (e.g., `experimental: {...}`)
- **AND** a user runs `taskless onboard --mark-complete`
- **THEN** the unknown field SHALL still be present after the write

### Requirement: Onboard recipe is embedded from help/onboard.txt

The CLI build SHALL embed `packages/cli/src/agent/onboard.txt` into the bundle via the same `import.meta.glob` mechanism used for other agent topics. The `taskless onboard` subcommand SHALL read the recipe content from the embedded bundle, not from the filesystem at runtime. The embedded recipe SHALL be the same content returned by `taskless agent onboard`.

#### Scenario: Recipe is available without filesystem access

- **WHEN** a user runs `taskless onboard` via `npx @taskless/cli`
- **THEN** the recipe content SHALL be served from the embedded bundle
- **AND** SHALL NOT require any filesystem reads under `packages/cli/src/agent/`

#### Scenario: Onboard and agent return the same recipe

- **WHEN** a user runs `taskless onboard --force` (recipe path)
- **AND** a user runs `taskless agent onboard`
- **THEN** the printed recipe content SHALL be identical between the two invocations

### Requirement: Onboard recipe follows the canonical recipe template and is conversational

The `onboard.txt` file SHALL follow the canonical recipe template defined in the `cli-agent` capability (header with CLI version + topic version, `## Goal`, `## Preconditions`, `## Steps`, `## Errors`, `## See Also`). The `## Steps` section SHALL describe a conversational discovery flow rather than a fixed sequence. Specifically, the recipe SHALL instruct the agent to:

1. Read `.taskless/taskless.json` and respect the `install.onboarded` field.
2. Open the conversation with a short menu of known sources for rule candidates: codebase TODOs/FIXMEs (via ripgrep or built-in search), agent-memory files (CLAUDE.md, AGENTS.md, .cursorrules, etc.), recent PR review comments (when `gh` is available), and issue-tracker tickets (when a relevant MCP is detected).
3. Encourage the user to suggest additional sources the agent may not know about.
4. Probe for tool availability before promising scans (e.g., check `command -v gh`, inspect available MCP tools).
5. For each chosen source, scan and filter for high-signal candidates: repeated patterns across multiple PRs/files/comments, comments that cite a doc or style guide, and merge-blocking review feedback. Filter out one-off nits and pure formatting feedback.
6. Synthesize a single bullet list where each bullet is a hypothetical rule expressed as `<kebab-case-name>: <one-line description of what it would enforce>`.
7. For each bullet, offer to materialize it via the existing `/tskl create rule` flow (link to the `rule create` topic via `npx @taskless/cli help rule create`).
8. At the end, ask the user whether they consider onboarding complete; on explicit yes, run `npx @taskless/cli onboard --mark-complete`.

The recipe SHALL warn the agent against marking onboarding complete without explicit user confirmation.

#### Scenario: Recipe header includes CLI and topic version

- **WHEN** `onboard.txt` is read
- **THEN** the first line SHALL match the canonical header format `# Topic: onboard     (CLI v<x.y.z> / topic v<n>)`

#### Scenario: Recipe enumerates the known source menu

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL list at least: codebase TODOs/FIXMEs, agent-memory files, PR review comments (with `gh`), and issue-tracker tickets (with MCP)

#### Scenario: Recipe encourages user-suggested sources

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL explicitly instruct the agent to ask the user whether other sources should be scanned

#### Scenario: Recipe specifies the bullet output shape

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL describe the rule-candidate output as a bullet list with `<kebab-case-name>: <description>` per item

#### Scenario: Recipe gates --mark-complete on user confirmation

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL instruct the agent to ask for explicit user confirmation before invoking `npx @taskless/cli onboard --mark-complete`
- **AND** SHALL warn that the agent must NOT mark onboarding complete without that confirmation

#### Scenario: Recipe references the rule-authoring route topic in See Also

- **WHEN** the `## See Also` section is read
- **THEN** it SHALL include a reference to `taskless agent route`

### Requirement: Onboard emits intent telemetry

The `taskless onboard` subcommand SHALL emit PostHog events on every invocation:

- `cli_onboard_recipe` when the recipe is printed (either because the user is not yet onboarded or `--force` was used).
- `cli_onboard_already_done` when the gate refuses to print the recipe because `install.onboarded === true` and `--force` was not set.
- `cli_onboard_marked_complete` when `--mark-complete` succeeds.

Events SHALL include a `forced` boolean property when relevant, and SHALL NOT include the contents of the manifest or any user-supplied content.

#### Scenario: Recipe path emits cli_onboard_recipe

- **WHEN** a user runs `taskless onboard` and the recipe is printed
- **THEN** PostHog SHALL receive a `cli_onboard_recipe` event
- **AND** the event SHALL include `forced: false`

#### Scenario: Forced recipe path emits cli_onboard_recipe with forced=true

- **WHEN** a user runs `taskless onboard --force`
- **THEN** PostHog SHALL receive a `cli_onboard_recipe` event with `forced: true`

#### Scenario: Already-onboarded gate emits cli_onboard_already_done

- **WHEN** a user runs `taskless onboard` and the gate refuses
- **THEN** PostHog SHALL receive a `cli_onboard_already_done` event

#### Scenario: Mark-complete emits cli_onboard_marked_complete

- **WHEN** `taskless onboard --mark-complete` succeeds
- **THEN** PostHog SHALL receive a `cli_onboard_marked_complete` event
