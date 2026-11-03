## ADDED Requirements

### Requirement: Skill acts on the preflight's environment report

The skill body SHALL tell the agent that `%(TASKLESS_CLI)s agent ok` returns a recipe whose body reports whether the Taskless environment is up to date. When it reports the environment is up to date, the body SHALL instruct the agent to proceed with the user's request.

When it reports the environment is out of date, the body SHALL instruct the agent to give the user the listed steps and their commands once, for the user to run themselves, and SHALL NOT instruct the agent to run them. The body SHALL name the ways to run them: in Claude Code, typing the command with the `!` prefix, which runs it in the session's shell; or in another terminal. The reason is that a harness whose permissions block Taskless commands usually blocks these steps too. The body SHALL instruct the agent to carry on with the user's request, and, when the user says they ran the steps, to run `%(TASKLESS_CLI)s agent ok` again to confirm.

That confirming run is the only time the body SHALL instruct the agent to run the preflight again in a session once it has passed.

The `!` prefix offered here is distinct from the blocked-preflight guidance, which does not offer it. There, `!` would clear only the one preflight call and leave every later Taskless command blocked. Here, the steps are one-off commands, and running them once is the whole job.

#### Scenario: Skill body explains both outcomes

- **WHEN** the skill body is read from source
- **THEN** it SHALL describe the up-to-date and the out-of-date outcomes of `agent ok`

#### Scenario: Skill body hands the steps to the user

- **WHEN** the skill body is read from source
- **THEN** it SHALL instruct the agent, on an out-of-date report, to give the user the listed steps once, to run themselves
- **AND** SHALL name the `!` prefix in Claude Code and another terminal as the ways to run them
- **AND** SHALL NOT instruct the agent to run the steps itself
- **AND** SHALL instruct the agent to carry on with the user's request

#### Scenario: Skill body re-checks after the user updates

- **WHEN** the skill body is read from source
- **THEN** it SHALL instruct the agent, once the user says they ran the steps, to run `agent ok` again

#### Scenario: Skill body runs the preflight once otherwise

- **WHEN** the skill body is read from source
- **THEN** it SHALL NOT instruct the agent to run `agent ok` again in a session after it has passed, except to confirm the user's update
