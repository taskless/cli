# cli-onboard Specification

## Purpose

Defines the `taskless onboard` subcommand: the post-install flow that takes a fresh user from zero rules to a working starter set and a published report. Unlike `taskless init` (which is fast, deterministic, and gets the user _installed_), `onboard` delivers an agent recipe that asks the user one question, "Do you want me to set up Taskless for you?", and on a yes mines the codebase, agent-memory files, review history, and any tracker or engineering context the agent can reach for high-signal rule candidates, writes every one the repository can enforce locally while logged out, publishes a Taskless report, and ends by strongly encouraging running the rules in CI.

This capability covers:

- **Subcommand surface**: three modes via flag combinations — default prints the recipe (refused when already complete), `--force` re-runs regardless of state, `--mark-complete` writes `install.onboarded: true`. `--force` and `--mark-complete` are mutually exclusive.
- **Manifest gating and writes**: the optional 3-state `install.onboarded` field on `.taskless/taskless.json` (absent / `false` / `true`) is the single source of truth for whether onboarding is complete. Only this subcommand writes the field, and only via `--mark-complete`, which the agent runs once the rules are written, under the consent of the user's opening yes.
- **Recipe embedding**: the recipe lives at `packages/cli/src/agent/onboard.md`, embedded into the CLI bundle at build time and rendered via the same sprintf-js path the `agent` command uses (`taskless agent onboard` returns the same content as `taskless onboard --force`).
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

### Requirement: Onboard recipe follows the canonical recipe template and asks one question

The `onboard.md` file SHALL follow the canonical recipe template defined in the `cli-agent` capability (header with CLI version + topic version, `## Goal`, `## Preconditions`, `## Steps`, `## Errors`, `## See Also`). The spec SHALL NOT pin the topic version: it changes with every revision of the recipe, and the recipe header is where it is recorded.

The recipe SHALL instruct the agent to:

1. Read `.taskless/taskless.json` and respect the `install.onboarded` field.
2. Ask the user exactly one question, "Do you want me to set up Taskless for you?", preceded by a scripted introduction the agent SHALL repeat word for word and SHALL NOT reword or extend, set apart from surrounding text by blank lines, and through the host's structured question tool when the host has one. The introduction SHALL name the sources in general terms (the repository, agent files, documentation, PRs, bug tracking), state that rules are written locally with no login, and state that a report is generated. The recipe SHALL state that a yes covers mining the repository, writing rules, publishing the report, and sending onboarding feedback. On anything but a yes the agent SHALL stop.
3. Establish the routing surface before proposing any candidate, by fetching the `route` topic for the destination criterion and running `taskless detect --json` for the repository's linters, languages, rule styles, host tools, and `agent` hints.
4. Mine every reachable source without asking which: codebase TODOs/FIXMEs, agent-memory files (CLAUDE.md, AGENTS.md, .cursorrules, and similar), review comments through whichever host tool `detect` reports present and applicable (pull requests through `gh`, merge requests through `glab`), the commit history of the window being mined, read for fixes that recur, and any MCP the agent has that reaches a bug tracker, an engineering-context tool, or architectural decisions. Whether to run a hinted command such as `gh auth status`, and which MCPs to use, SHALL be left to the agent.
5. Filter for high-signal candidates: repeated patterns across multiple PRs/files/comments, comments that cite a doc or style guide, and merge-blocking review feedback; drop one-off nits and pure formatting feedback. Commit-history evidence SHALL choose candidates only; the recipe SHALL state that it never counts toward a rule's `surfaced`, which counts review comments alone.
6. Author every candidate the routing surface sends to a local destination (`legacy`, `sg`, or `vale`) by following the `route` topic, without asking per candidate.
7. Record, and not author, every candidate the agent judges better solved by a runtime rule, for the report's `cloud` tier, noting how many instances of its pattern the agent saw in the code, which the report takes as that candidate's estimate.
8. Once the rules are written, run `taskless onboard --mark-complete` without asking.
9. Hand off to the `report` topic to publish the report, and, in parallel, send onboarding feedback by following the `rule-feedback` topic as the respondent.
10. Close by showing the report summary, then, as the last thing the agent does, offer to wire `taskless check` into the repository's CI by following the `ci` topic, and strongly encourage it: Taskless checks in CI are what keep agents from reintroducing the patterns these rules catch. The offer SHALL name the CI systems `detect --json` found. On a yes the agent SHALL follow the `ci` topic; on a no it SHALL name the `hooks` topic in one line as the local alternative. Either way, the agent's final message SHALL end with the report link on its own line, as a plain URL or a Markdown link and not inside a code block, and the agent SHALL then stop. The link SHALL be the one the report summary showed, never the contents of the record in `.taskless/reports/`.

The recipe SHALL operate logged out throughout. It SHALL NOT direct the agent to `auth login`, and SHALL NOT author a runtime rule.

Beyond the opening question and the closing CI offer, the recipe SHALL permit a question only when the agent is unsure what rules to write AND the `report` topic's gate has refused for too few Taskless rules. It SHALL limit such a question to what would let the agent write the missing rules.

The recipe SHALL describe a detected tool as present, never as verified, and SHALL NOT instruct the agent to run `command -v` or any equivalent probe for a tool `detect` reports on.

The recipe SHALL NOT name one bug tracker as the expected one. It MAY name trackers such as Jira and Linear as examples of the class.

When a review-comment source is unavailable, the recipe SHALL say in one line why, stating the reason that cannot be remedied first: a repository whose `origin` is on neither GitHub nor GitLab SHALL be told there are no pull or merge requests to mine, not that a CLI is missing.

The recipe SHALL NOT restate the destination criterion itself; it SHALL reference the `route` topic.

#### Scenario: Recipe header includes CLI and topic version

- **WHEN** `onboard.md` is read
- **THEN** the first line SHALL match the canonical header format `# Topic: onboard     (CLI v<x.y.z> / topic v<n>)`

#### Scenario: The opening question is the only scripted question

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL contain the question "Do you want me to set up Taskless for you?"
- **AND** SHALL precede it with the scripted introduction, and direct the agent not to reword or extend it
- **AND** SHALL direct the agent to use the host's structured question tool when one exists
- **AND** no other step SHALL direct the agent to ask the user a question, except the step handling a refused report gate and the closing CI offer

#### Scenario: Recipe establishes the routing surface before proposing candidates

- **WHEN** the recipe `## Steps` section is read
- **THEN** a step instructing the agent to fetch the `route` topic and to run `detect --json` SHALL appear before the step that authors rules

#### Scenario: Recipe does not duplicate the destination criterion

- **WHEN** `onboard.md` is read
- **THEN** it SHALL NOT contain a table or enumeration comparing the rule destinations against one another
- **AND** it SHALL direct the agent to the `route` topic for that comparison

#### Scenario: Sources are mined without a menu

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL name codebase TODOs/FIXMEs, agent-memory files, review comments, commit history, and MCP-reachable trackers and engineering context as sources
- **AND** SHALL NOT direct the agent to ask the user which sources to include

#### Scenario: A present and applicable tool is offered as present

- **WHEN** the recipe is rendered for a GitHub repository on a host where `gh` is on `PATH`
- **THEN** the review-comment source SHALL be included
- **AND** the text SHALL state that `gh` is on the PATH and that Taskless did not run it

#### Scenario: An absent tool is omitted with its reason

- **WHEN** the recipe is rendered for a GitHub repository on a host where `gh` is not on `PATH`
- **THEN** the review-comment source SHALL NOT be included
- **AND** the recipe SHALL state in one line that `gh` was not found on the PATH

#### Scenario: A repository on neither host is told the source does not apply

- **WHEN** the recipe is rendered for a repository whose `origin` is on neither GitHub nor GitLab, whatever tools are on `PATH`
- **THEN** the review-comment source SHALL NOT be included
- **AND** the stated reason SHALL be that there are no pull or merge requests to mine

#### Scenario: Onboarding stays logged out

- **WHEN** `onboard.md` is read
- **THEN** it SHALL NOT direct the agent to `auth login`
- **AND** SHALL direct runtime-shaped candidates to the report's `cloud` tier rather than to authoring
- **AND** SHALL direct the agent to note how many instances of each such candidate's pattern it saw, for the report's estimate

#### Scenario: Onboarding completes without a confirmation question

- **WHEN** the recipe `## Steps` section is read
- **THEN** it SHALL direct the agent to run `taskless onboard --mark-complete` once the rules are written
- **AND** SHALL NOT direct the agent to ask before doing so

#### Scenario: Onboarding hands off to the report and sends feedback

- **WHEN** the recipe `## Steps` section is read
- **THEN** a step after mark-complete SHALL direct the agent to the `report` topic
- **AND** SHALL direct it to follow the `rule-feedback` topic as the respondent

#### Scenario: CI is offered last and strongly encouraged

- **WHEN** the recipe's closing step is read
- **THEN** it SHALL appear after the report summary is shown and be the last step
- **AND** it SHALL direct the agent to offer wiring `check` into CI via the `ci` topic, naming the CI systems `detect --json` found
- **AND** it SHALL direct the agent to strongly encourage a yes, stating that checks in CI keep agents from reintroducing what the rules catch

#### Scenario: Declining CI points at hooks

- **WHEN** the user declines the CI offer
- **THEN** the recipe SHALL direct the agent to name the `hooks` topic in one line, end with the report link, and stop

#### Scenario: The final message ends with the report link

- **WHEN** the recipe's closing step is read
- **THEN** it SHALL direct the agent to end its final message with the report link on its own line, whether the user accepted or declined CI
- **AND** SHALL direct that the link be a plain URL or a Markdown link, not inside a code block
- **AND** SHALL direct the agent not to print the record in `.taskless/reports/`, which holds the delete URL

#### Scenario: Recipe references its neighbors in See Also

- **WHEN** the `## See Also` section is read
- **THEN** it SHALL include references to `taskless agent route`, `taskless agent report`, `taskless agent rule-feedback`, `taskless agent ci`, and `taskless agent hooks`

#### Scenario: Commit history is mined for recurring fixes

- **WHEN** the recipe is rendered, in any host-tool state
- **THEN** the sources SHALL include the commit history of the window, read for fixes that recur
- **AND** the recipe SHALL state that such fixes can be the only signal in a repository reviewed before its pull requests open, or written mostly by agents

#### Scenario: Commit evidence does not count as surfaced

- **WHEN** the recipe's scan step is read
- **THEN** it SHALL state that evidence from commit history chooses candidates and does not count toward `surfaced`

### Requirement: Onboard recipe first checks a worktree has Taskless committed

The onboard recipe's first step SHALL have the agent run `git rev-parse --path-format=absolute --git-dir --git-common-dir`, and SHALL go on when the directory is not a git repository or the two paths match. When they differ, the agent is in a linked worktree, and the recipe SHALL have it run `git ls-files .taskless/taskless.json`. When that prints nothing and the main checkout, the directory holding the common git directory, has a `.taskless/`, the recipe SHALL have the agent stop and tell the user that `init`'s files are most likely uncommitted in their main checkout, to commit `.taskless/` and the skill directories there, and to start a new worktree and ask to onboard again. When the main checkout has no `.taskless/`, the recipe SHALL treat `init` as having run in the worktree and go on.

The step SHALL test whether `.taskless/` is tracked, not whether it exists, because the `onboard` subcommand bootstraps an empty `.taskless/` before it serves the recipe.

#### Scenario: The check comes before reading the manifest

- **WHEN** the onboard recipe is rendered
- **THEN** its first step SHALL be the worktree check
- **AND** it SHALL come before the step that reads the manifest

#### Scenario: A worktree cut before init was committed stops onboarding

- **WHEN** the agent is in a linked worktree, `.taskless/taskless.json` is not tracked, and the main checkout has a `.taskless/`
- **THEN** the recipe SHALL have the agent stop and tell the user to commit `init`'s files in the main checkout and start a new worktree

#### Scenario: Init run inside the worktree continues

- **WHEN** the agent is in a linked worktree, `.taskless/taskless.json` is not tracked, and the main checkout has no `.taskless/`
- **THEN** the recipe SHALL have the agent go on with onboarding
