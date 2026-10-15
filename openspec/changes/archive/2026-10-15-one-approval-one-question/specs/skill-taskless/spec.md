## MODIFIED Requirements

### Requirement: Skill body is a router, not an inline recipe

The consolidated skill body SHALL NOT contain step-by-step instructions for any individual Taskless task. The body SHALL be a router that:

1. States explicitly that the agent does NOT have the steps for any Taskless action in its context.
2. Instructs the agent to fetch the canonical recipe via `npx @taskless/cli help <topic>` before proceeding.
3. Provides a topic disambiguation table mapping user intents to topic names. The table SHALL include a row for the new `onboard` topic.
4. Includes a `## --anonymous` section explaining the global flag's behavior.
5. Includes a first-step `.taskless/` presence check with graceful failure ("ask the user to confirm they meant Taskless").
6. Includes a `## Quiet suggestion` (or equivalently named) section governing the proactive trigger introduced via the description's named-tool clause. This section SHALL specify that:
   - When the skill triggers because the user wants to add a rule and has not named a specific tool, the agent SHALL surface a single-line offer to capture the rule via Taskless rather than launching into a full recipe (e.g., "I can capture this as a Taskless rule if you want — say so, or I'll proceed with X").
   - If the user declines or ignores the offer, the agent SHALL proceed with whatever it would have done without the skill.
   - If the user declines, the agent SHALL NOT re-offer Taskless in the same conversation. No persistent decline state SHALL be written to disk.
   - If the user accepts, the skill router SHALL proceed normally to fetch `npx @taskless/cli help rule create`.
7. States that a recipe is resolved when it is fetched and is not reusable across tasks: the agent SHALL fetch the recipe at the start of every Taskless task, including a topic it already fetched earlier in the same session, and SHALL NOT act on an earlier copy.
8. Names the CLI through the `%(TASKLESS_CLI)s` placeholder everywhere it spells an invocation, never as the literal `npx @taskless/cli`. The install renders the placeholder to the build's invocation, so a nightly or path-form build serves a skill that names itself.

The body SHALL be no more than 150 lines of markdown. The cap guards against unbounded growth of a body loaded on every Taskless task; it SHALL NOT be met by compressing guidance the router needs. When the body needs more room to route correctly, the cap is raised instead. (Earlier caps of 60 and then 80 lines forced exactly that compression.)

#### Scenario: Skill body warns against improvising

- **WHEN** the skill body is read by an agent
- **THEN** it SHALL contain explicit framing such as "You do NOT have the steps... do not improvise from prior knowledge"

#### Scenario: Skill body spells the invocation as a placeholder

- **WHEN** the skill body is read from source
- **THEN** every CLI invocation SHALL be written as `%(TASKLESS_CLI)s …`
- **AND** the body SHALL NOT contain the literal `npx @taskless/cli`

#### Scenario: Skill body forbids reusing a fetched recipe

- **WHEN** the skill body is read by an agent
- **THEN** it SHALL state that a recipe is resolved at fetch time and that each Taskless task fetches its recipe again, even for a topic fetched earlier in the session

#### Scenario: Skill body lists available topics including onboard

- **WHEN** the skill body is read by an agent
- **THEN** it SHALL include a table or list mapping user intents to the corresponding `%(TASKLESS_CLI)s agent <topic>` invocations
- **AND** the table SHALL include a row for `onboard` mapped to `npx @taskless/cli agent onboard` (or equivalent invocation of the onboard topic)

#### Scenario: Skill body checks for .taskless directory

- **WHEN** the skill is invoked
- **THEN** the body's first step SHALL instruct the agent to check whether `.taskless/` exists in the working directory
- **AND** to ask the user to confirm Taskless is what they meant if the directory is absent

#### Scenario: Skill body specifies quiet suggestion behavior

- **WHEN** the skill is triggered by the unspecified-tool clause from the description
- **THEN** the body's quiet-suggestion section SHALL instruct the agent to surface a single-line offer rather than a full recipe
- **AND** SHALL instruct the agent NOT to re-offer in the same conversation if declined
- **AND** SHALL specify that no persistent decline state is written

#### Scenario: Skill body specifies in-conversation decline is sticky

- **WHEN** the user has declined a quiet-suggestion offer once in the current conversation
- **THEN** the body SHALL instruct the agent not to surface the offer again in the same conversation

#### Scenario: Skill body length cap

- **WHEN** the skill body is measured
- **THEN** it SHALL be no more than 150 lines of markdown

### Requirement: Skill preflights the CLI before the first Taskless command

The skill body SHALL instruct the agent to run `%(TASKLESS_CLI)s agent ok` once per session, before any other Taskless command, and to proceed only once it prints its confirmation line. Once it does, the agent SHALL go straight to the user's request, without surveying the install or offering a menu of topics.

When the preflight is blocked by the harness or the user, the body SHALL instruct the agent to:

1. Stop before doing any Taskless work, and not attempt to work around the block.
2. Send one message that names the exact command, and says it downloads and runs a package from npm.
3. Offer the user three ways forward: the agent adds an allow rule for exactly the invocation the skill names to the agent's permission settings, and if the harness blocks that edit too, gives the user the change to make themselves; the user approves it through their agent's permissions command (in Claude Code, `/permissions` with the rule `Bash(<invocation>:*)`); or the user approves every Taskless command manually, in chat, as the agent runs it.
4. Never propose an allow rule that widens the invocation, such as a wildcard over the package name or its version.
5. Not ask in that message what the user wants Taskless to do. Their request stands, and the agent carries it out once the command is unblocked.

#### Scenario: Skill body runs the preflight first

- **WHEN** the skill body is read from source
- **THEN** it SHALL instruct the agent to run `%(TASKLESS_CLI)s agent ok` before any other Taskless command in the session

#### Scenario: Skill body handles a blocked preflight

- **WHEN** the skill body is read from source
- **THEN** it SHALL instruct the agent, on a blocked preflight, to stop and name the exact command to the user in one message
- **AND** SHALL offer an allow rule for the exact invocation added by the agent, with the user making the change when the harness blocks the agent's edit
- **AND** SHALL offer the agent's permissions command, and per-command approval in chat
- **AND** SHALL NOT offer running the command with `!`, which unblocks only the preflight
- **AND** SHALL forbid an allow rule that wildcards the package name or version
- **AND** SHALL forbid asking what the user wants Taskless to do in that message

## ADDED Requirements

### Requirement: A request that names no task routes to onboarding

The skill body SHALL route a request to use, try, or set up Taskless that names no task to `%(TASKLESS_CLI)s agent onboard`, without first offering a menu of topics. The onboard recipe's question SHALL be the only question the agent asks before onboarding begins.

#### Scenario: A generic request goes to onboard

- **WHEN** the skill body is read from source
- **THEN** it SHALL route a request that names no task to `agent onboard`
- **AND** SHALL instruct the agent not to offer a menu of topics first

## REMOVED Requirements

### Requirement: Skill maps to a single tskl command

**Reason**: The `tskl` slash command is removed. It duplicated the skill's routing in a second body that had to be kept in step by hand, and a plain request to the agent reaches the same skill.

**Migration**: Ask the agent in plain language ("set up taskless", "add taskless to CI"); the `taskless` skill triggers on it. An upgrade removes installed `tskl` command files.
