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
7. States that a recipe is resolved when it is fetched and is not reusable across tasks: the agent SHALL fetch the recipe at the start of every Taskless task, including a topic it already fetched earlier in the same session, and SHALL NOT act on an earlier copy. The `tskl` command body SHALL carry the same statement.
8. Names the CLI through the `%(TASKLESS_CLI)s` placeholder everywhere it spells an invocation, never as the literal `npx @taskless/cli`. The install renders the placeholder to the build's invocation, so a nightly or path-form build serves a skill that names itself.

The body SHALL be no more than 80 lines of markdown to keep the always-loaded surface small. (The previous 60-line cap is relaxed to accommodate the new quiet-suggestion section and the `onboard` row.)

#### Scenario: Skill body warns against improvising

- **WHEN** the skill body is read by an agent
- **THEN** it SHALL contain explicit framing such as "You do NOT have the steps... do not improvise from prior knowledge"

#### Scenario: Skill body spells the invocation as a placeholder

- **WHEN** the skill body or the `tskl` command body is read from source
- **THEN** every CLI invocation SHALL be written as `%(TASKLESS_CLI)s …`
- **AND** the body SHALL NOT contain the literal `npx @taskless/cli`

#### Scenario: Skill body forbids reusing a fetched recipe

- **WHEN** the skill body or the `tskl` command body is read by an agent
- **THEN** it SHALL state that a recipe is resolved at fetch time and that each Taskless task fetches its recipe again, even for a topic fetched earlier in the session

#### Scenario: Skill body lists available topics including onboard

- **WHEN** the skill body is read by an agent
- **THEN** it SHALL include a table or list mapping user intents to the corresponding `tskl agent <topic>` invocations
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
- **THEN** it SHALL be no more than 80 lines of markdown
