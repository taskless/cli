## MODIFIED Requirements

### Requirement: Skill preflights the CLI before the first Taskless command

The skill body and the `tskl` command body SHALL instruct the agent to run `%(TASKLESS_CLI)s agent ok` once per session, before any other Taskless command, and to proceed only once it prints its confirmation line.

When the preflight is blocked by the harness or the user, the bodies SHALL instruct the agent to:

1. Stop before doing any Taskless work, and not attempt to work around the block.
2. Tell the user the exact command, and that it downloads and runs a package from npm.
3. Offer the user three ways forward, and wait for their choice: the agent adds an allow rule for exactly the invocation the skill names to the agent's permission settings; the user approves it through their agent's permissions command, such as `/permissions` in Claude Code; or the user approves every Taskless command manually, in chat, as the agent runs it.
4. Never propose an allow rule that widens the invocation, such as a wildcard over the package name or its version.

#### Scenario: Skill body runs the preflight first

- **WHEN** the skill body or the `tskl` command body is read from source
- **THEN** it SHALL instruct the agent to run `%(TASKLESS_CLI)s agent ok` before any other Taskless command in the session

#### Scenario: Skill body handles a blocked preflight

- **WHEN** the skill body or the `tskl` command body is read from source
- **THEN** it SHALL instruct the agent, on a blocked preflight, to stop and name the exact command to the user
- **AND** SHALL offer an allow rule for the exact invocation, the agent's permissions command, and per-command approval in chat
- **AND** SHALL NOT offer running the command with `!`, which unblocks only the preflight
- **AND** SHALL forbid an allow rule that wildcards the package name or version
