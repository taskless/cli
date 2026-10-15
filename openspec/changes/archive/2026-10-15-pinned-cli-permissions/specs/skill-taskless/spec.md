## MODIFIED Requirements

### Requirement: Skill preflights the CLI before the first Taskless command

The skill body SHALL instruct the agent to run `%(TASKLESS_CLI)s agent ok` once per session, before any other Taskless command, and to proceed only once it prints its confirmation line. Once it does, the agent SHALL go straight to the user's request, without surveying the install or offering a menu of topics. On an install whose harness permission rule is in place the preflight passes without a prompt; the guidance below is the fallback for when it does not.

When the preflight is blocked by the harness or the user, the body SHALL instruct the agent to:

1. Stop before doing any Taskless work, and not attempt to work around the block.
2. Send one message that names the exact command, and says it downloads and runs a package from npm.
3. Offer the user three ways forward: the agent adds an allow rule for exactly the invocation the skill names to the agent's permission settings, and if the harness blocks that edit too, gives the user the change to make themselves; the user approves it through their agent's permissions command (in Claude Code, `/permissions` with the rule `Bash(<invocation>:*)`); or the user approves every Taskless command manually, in chat, as the agent runs it.
4. Never propose an allow rule that widens the invocation, such as a wildcard over the package name or its version. Where the harness's allowlist cannot scope to the one invocation, for example one that only allows a whole tool, offer per-command approval in chat instead of a rule.
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
- **AND** SHALL offer only per-command approval where the harness cannot allow the one invocation without allowing a whole tool
- **AND** SHALL forbid asking what the user wants Taskless to do in that message
