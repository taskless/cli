## ADDED Requirements

### Requirement: Every recipe states the one-command-per-call rule

Every recipe file at `packages/cli/src/agent/<topic>.md`, except `feedback-invite.md`, SHALL carry the `%(ONE_COMMAND_PER_CALL)s` placeholder as its own paragraph directly beneath the `# Topic:` header line and its closing blank line, before `## Goal`. The renderer SHALL substitute one shared paragraph, identical for every topic except for the rendered invocation, which SHALL be the same value `%(TASKLESS_CLI)s` resolves to. The paragraph SHALL tell the agent to run each Taskless command as its own shell call, starting the line with the invocation and chaining nothing to it (no variable assignment, `cd`, `mkdir`, `&&`, `;`, pipe, redirect, or command substitution), to read output from the call's result, and to write any file a recipe asks for with its file tools.

When rendered with `mechanics: false`, the paragraph SHALL name no invocation and SHALL say "the Taskless invocation" in its place, because a caller with no CLI receives no invocations. The paragraph SHALL sit outside the header block, so `header: false` SHALL NOT remove it. `feedback-invite.md` is exempt because it is never served alone: the survey gate appends it, without its header, beneath a recipe that already carries the paragraph. A recipe's own command examples SHALL follow the rule: no example the agent is told to run SHALL chain anything to a Taskless command. Text the agent writes into a file, such as a CI job or a git hook, is not a command the agent runs and is exempt.

#### Scenario: Every topic renders the paragraph

- **WHEN** any topic other than `feedback-invite` is rendered
- **THEN** the text SHALL contain the one-command-per-call paragraph with the resolved invocation

#### Scenario: The paragraph survives header suppression

- **WHEN** a recipe is rendered with `header: false`
- **THEN** the text SHALL still contain the one-command-per-call paragraph

#### Scenario: A caller with no CLI gets the rule without an invocation

- **WHEN** a recipe is rendered with `mechanics: false`
- **THEN** the paragraph SHALL say "the Taskless invocation" and SHALL NOT contain an invocation or the `<taskless-cli>` marker

#### Scenario: A diff-scoped check is not a command substitution

- **WHEN** the `check` recipe describes scanning the files a branch changed
- **THEN** it SHALL tell the agent to run `git diff --name-only` as its own call and pass the paths it printed
- **AND** SHALL NOT show `$(git diff ...)` inside a Taskless command line
