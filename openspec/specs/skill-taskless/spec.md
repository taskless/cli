# Skill: Taskless

## Purpose

Defines the single consolidated `taskless` skill that replaced the per-task skills (`taskless-check`, `taskless-create-rule`, `taskless-create-rule-anonymous`, `taskless-improve-rule`, `taskless-improve-rule-anonymous`, `taskless-delete-rule`, `taskless-info`, `taskless-login`, `taskless-logout`, `taskless-ci`) in v0.7. The skill body is a small router whose canonical recipes live behind `npx @taskless/cli help <topic>`, fetched on demand by the agent rather than always loaded.

## Requirements

### Requirement: Single consolidated taskless skill replaces per-task skills

The skills bundle SHALL contain exactly one skill named `taskless`. This skill SHALL replace the per-task skills `taskless-check`, `taskless-create-rule`, `taskless-create-rule-anonymous`, `taskless-improve-rule`, `taskless-improve-rule-anonymous`, `taskless-delete-rule`, `taskless-info`, `taskless-login`, `taskless-logout`, and `taskless-ci`. The skill SHALL be installed into every detected tool location (Claude Code, OpenCode, Cursor, etc.) per the existing install plumbing.

#### Scenario: Bundle contains exactly one skill

- **WHEN** the CLI bundle is built
- **THEN** `import.meta.glob("../../../../skills/**/SKILL.md")` SHALL match exactly one file at `skills/taskless/SKILL.md`

#### Scenario: Skill catalog has one entry

- **WHEN** `getMandatorySkillNames()` is called
- **THEN** it SHALL return `["taskless"]`
- **AND** `getOptionalSkillNames()` SHALL return `[]`

#### Scenario: Old skill directories are removed

- **WHEN** the v0.7.0 release is built
- **THEN** none of the directories `skills/taskless-check`, `skills/taskless-ci`, `skills/taskless-create-rule`, `skills/taskless-create-rule-anonymous`, `skills/taskless-delete-rule`, `skills/taskless-improve-rule`, `skills/taskless-improve-rule-anonymous`, `skills/taskless-info`, `skills/taskless-login`, or `skills/taskless-logout` SHALL exist in the repository

### Requirement: Skill description anchors triggers on Taskless-specific phrases

The consolidated skill's `description` frontmatter field SHALL anchor triggers on:

1. An explicit reference to "Taskless" in the user's message, OR
2. A reference to the `.taskless/` directory or files within it (rules, rule-tests, rule-metadata), OR
3. A request to add/write/create a rule for code, including requests that name a specific lint/format/static-analysis tool (for example eslint, ruff, biome, stylelint, ast-grep). Naming such a tool SHALL engage the skill's routing flow rather than suppress it; the skill routes the request toward the appropriate authoring destination via `npx @taskless/cli help route`.

The description SHALL NOT instruct the agent to suppress or quiet itself merely because a lint/format/static-analysis tool is named, and SHALL NOT contain a blanket "do NOT trigger on generic linting" instruction.

#### Scenario: Description includes anchored trigger phrases

- **WHEN** the skill `description` field is read
- **THEN** it SHALL include trigger phrases such as "create/add/write a taskless rule", "improve/fix/iterate on this taskless rule", "run taskless", "taskless login", "add taskless to CI"
- **AND** SHALL include a rule-authoring clause covering "add/write/create a rule" for code

#### Scenario: Naming a linter engages routing rather than suppressing

- **WHEN** the user asks to add/write/create a rule and names a specific lint/format/static-analysis tool (for example "write an eslint rule for X")
- **THEN** the skill SHALL trigger and route the request via `npx @taskless/cli help route`
- **AND** SHALL NOT quiet itself to a one-line offer on the basis of the named tool

#### Scenario: Description omits suppression and the prior blanket carve-out

- **WHEN** the skill `description` field is read
- **THEN** it SHALL NOT contain wording instructing the agent to suppress on a named lint/format/static-analysis tool
- **AND** it SHALL NOT contain wording instructing the agent to never trigger on generic ESLint/linting requests

#### Scenario: Description is at most 1024 characters

- **WHEN** the skill `description` field length is measured
- **THEN** it SHALL be at most 1024 characters (Agent Skills spec limit)

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

The body SHALL be no more than 200 lines of markdown. The cap guards against unbounded growth of a body loaded on every Taskless task; it SHALL NOT be met by compressing guidance the router needs. When the body needs more room to route correctly, the cap is raised instead. (Earlier caps of 60 and then 80 lines forced exactly that compression; 150 was reached exactly by the standalone-command rule and the present-entry fallback.)

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
- **THEN** it SHALL be no more than 200 lines of markdown

### Requirement: Skill routes authoring requests through the routing front door

The skill body SHALL route rule-authoring requests through `npx @taskless/cli help route`
as the authoring front door, rather than fetching `rule create` directly. The
skill SHALL add no linter knowledge of its own and SHALL remain a thin router that
defers all authoring judgment to the fetched recipes.

#### Scenario: Authoring requests are routed via route

- **WHEN** the user asks to author a rule (with or without naming a tool)
- **THEN** the skill body SHALL direct the agent to fetch `npx @taskless/cli help route`
  before any login-gated path
- **AND** SHALL NOT embed linter-specific rule knowledge in the skill body

#### Scenario: Local-first before login

- **WHEN** the routing recipe has not yet demonstrated that a rule cannot be built
  locally
- **THEN** the skill SHALL NOT direct the agent toward a login-gated authoring
  path

### Requirement: Skill routes report requests to the report topic

The skill body's topic table SHALL map a request to make, publish, regenerate, or delete a Taskless report to the `report` topic, invoked through the `%(TASKLESS_CLI)s` placeholder like every other row. The skill SHALL add no report steps of its own; the fetched recipe carries them.

#### Scenario: A report request routes to the report topic

- **WHEN** the skill body is read by an agent
- **THEN** its topic table SHALL include a row mapping report requests to `%(TASKLESS_CLI)s agent report`

#### Scenario: The skill carries no report steps

- **WHEN** the skill body is read
- **THEN** it SHALL NOT describe how to assemble, publish, or delete a report

### Requirement: Skill preflights the CLI before the first Taskless command

The skill body SHALL instruct the agent to run `%(TASKLESS_CLI)s agent ok` once per session, before any other Taskless command, and to proceed only once it prints its confirmation line. Once it does, the agent SHALL go straight to the user's request, without surveying the install or offering a menu of topics. On an install whose harness permission rule is in place the preflight passes without a prompt; the guidance below is the fallback for when it does not.

When the preflight, or any later Taskless command, is blocked by the harness or the user, the body SHALL instruct the agent to:

1. Stop before doing any further Taskless work, and not retry the command or attempt to work around the block. The one exception is a command that was refused while combined with other commands on its line: the agent SHALL rerun it once, on its own, before treating it as blocked.
2. Send one message that names the exact command, and says it downloads and runs a package from npm.
3. When the refusal came from the agent's own safety classifier rather than a missing permission (in Claude Code, a denial by the auto mode classifier), say that an allow rule cannot clear it. When the user's settings (in Claude Code, top-level `autoMode.allow` in `~/.claude/settings.json`) already hold an entry beginning `Taskless CLI:` that matches the global trust entry, the agent SHALL say the entry is present and SHALL NOT tell the user to add it. When the entry is absent, or carries the label with different text, the agent SHALL give the user the global trust entry, inline, with the file and key to add it under, after `"$defaults"`, replacing an older `Taskless CLI:` entry. The agent SHALL NOT write that entry itself. In every case it SHALL also offer running the CLI with no arguments in a terminal, which offers to add or refresh the entry, per-command approval in chat, and leaving the classifier's mode, as the alternatives.
4. Otherwise, offer the user three ways forward: the agent adds an allow rule for exactly the invocation the skill names to the agent's permission settings, and if the harness blocks that edit too, gives the user the change to make themselves; the user approves it through their agent's permissions command (in Claude Code, `/permissions` with the rule `Bash(<invocation>:*)`); or the user approves every Taskless command manually, in chat, as the agent runs it.
5. Never propose an allow rule that widens the invocation, such as a wildcard over the package name or its version. Where the harness's allowlist cannot scope to the one invocation, for example one that only allows a whole tool, offer per-command approval in chat instead of a rule.
6. Not ask in that message what the user wants Taskless to do. Their request stands, and the agent carries it out once the command is unblocked.

The global trust entry and these instructions SHALL be written in the skill body itself, not fetched from an `agent <topic>` recipe, because a recipe is fetched through the same command that is blocked.

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
- **AND** SHALL offer only per-command approval where the harness cannot allow the one invocation without allowing a whole tool
- **AND** SHALL forbid asking what the user wants Taskless to do in that message

#### Scenario: Skill body handles a classifier refusal

- **WHEN** the skill body is read from source
- **THEN** it SHALL instruct the agent, when a Taskless command is refused by the agent's safety classifier, to stop without retrying
- **AND** SHALL contain the global trust entry text inline, beginning `Taskless CLI:`
- **AND** SHALL name `~/.claude/settings.json` and `autoMode.allow` for Claude Code
- **AND** SHALL NOT offer a project allow rule for that refusal
- **AND** SHALL forbid the agent from writing the entry itself

#### Scenario: A present entry is not asked for again

- **WHEN** the skill body is read from source
- **THEN** it SHALL instruct the agent, when the classifier refuses a Taskless command and the current entry is already in the user's settings, to say so and not tell the user to add it

#### Scenario: A combined command is rerun on its own once

- **WHEN** the skill body is read from source
- **THEN** it SHALL instruct the agent, when a refused Taskless command was combined with other commands on its line, to rerun it once on its own before treating it as blocked

#### Scenario: The fallback does not depend on a recipe

- **WHEN** the skill body is read from source
- **THEN** its blocked-command guidance SHALL NOT instruct the agent to run an `agent <topic>` command to learn how to unblock

### Requirement: A request that names no task routes to onboarding

The skill body SHALL route a request to use, try, or set up Taskless that names no task to `%(TASKLESS_CLI)s agent onboard`, without first offering a menu of topics. The onboard recipe's question SHALL be the only question the agent asks before onboarding begins.

#### Scenario: A generic request goes to onboard

- **WHEN** the skill body is read from source
- **THEN** it SHALL route a request that names no task to `agent onboard`
- **AND** SHALL instruct the agent not to offer a menu of topics first

### Requirement: Taskless commands run on their own

The skill body SHALL instruct the agent to run every Taskless command as a command line of its own that begins with the pinned invocation, with nothing before or after it: no variable assignment, `cd`, `mkdir`, `&&`, `;`, pipe, or output redirect. The body SHALL say why: a permission rule and a classifier exception both recognise the pinned call, and a line that starts with anything else, or hands the call's output to another command, is judged as something else. The agent SHALL read the call's output from its result, and SHALL write a file a recipe asks for with its own file tools rather than through a redirect.

#### Scenario: Skill body requires standalone commands

- **WHEN** the skill body is read from source
- **THEN** it SHALL instruct the agent to run each Taskless command on its own line, beginning with `%(TASKLESS_CLI)s`
- **AND** SHALL name variable assignments, `cd`, `mkdir`, `&&`, pipes, and redirects as things not to combine with it

#### Scenario: Files go through the agent's file tools

- **WHEN** the skill body is read from source
- **THEN** it SHALL instruct the agent to write a file a recipe asks for with its file tools, not by redirecting a Taskless command's output
