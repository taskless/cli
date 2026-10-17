## MODIFIED Requirements

### Requirement: Skill preflights the CLI before the first Taskless command

The skill body SHALL instruct the agent to run `%(TASKLESS_CLI)s agent ok` once per session, before any other Taskless command, and to proceed only once it prints its confirmation line. Once it does, the agent SHALL go straight to the user's request, without surveying the install or offering a menu of topics. On an install whose harness permission rule is in place the preflight passes without a prompt; the guidance below is the fallback for when it does not.

When the preflight, or any later Taskless command, is blocked by the harness or the user, the body SHALL instruct the agent to:

1. Stop before doing any further Taskless work, and not retry the command or attempt to work around the block. The one exception is a command that was refused while combined with other commands on its line: the agent SHALL rerun it once, on its own, before treating it as blocked.
2. Send one message that names the exact command, and says it downloads and runs a package from npm.
3. When the refusal came from the agent's own safety classifier rather than a missing permission (in Claude Code, a denial by the auto mode classifier), say that an allow rule cannot clear it. When the user's settings (in Claude Code, top-level `autoMode.allow` in `~/.claude/settings.json`) already hold an entry that matches this build's global trust entry, the agent SHALL say the entry is present and SHALL NOT tell the user to add it. When the entry is absent, or carries the label with different text, the agent SHALL give the user the global trust entry, inline, with the file and key to add it under, after `"$defaults"`, replacing an older entry under this build's label. The agent SHALL NOT write that entry itself. In every case it SHALL also offer running the CLI with no arguments in a terminal, which offers to add or refresh the entry, per-command approval in chat, and leaving the classifier's mode, as the alternatives.
4. Otherwise, offer the user three ways forward: the agent adds an allow rule for exactly the invocation the skill names to the agent's permission settings, and if the harness blocks that edit too, gives the user the change to make themselves; the user approves it through their agent's permissions command (in Claude Code, `/permissions` with the rule `Bash(<invocation>:*)`); or the user approves every Taskless command manually, in chat, as the agent runs it.
5. Never propose an allow rule that widens the invocation, such as a wildcard over the package name or its version. Where the harness's allowlist cannot scope to the one invocation, for example one that only allows a whole tool, offer per-command approval in chat instead of a rule.
6. Not ask in that message what the user wants Taskless to do. Their request stands, and the agent carries it out once the command is unblocked.

The global trust entry and these instructions SHALL be written in the skill body itself, the entry and its label as placeholders that install renders to the installing build's entry and label, not fetched from an `agent <topic>` recipe, because a recipe is fetched through the same command that is blocked.

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
- **AND** SHALL contain this build's global trust entry inline once installed: the release's, beginning `Taskless CLI:`, from the released build, and the nightly's, beginning `Taskless CLI nightly:`, from a nightly
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
