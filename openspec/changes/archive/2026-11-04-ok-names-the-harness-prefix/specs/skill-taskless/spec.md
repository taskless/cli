## MODIFIED Requirements

### Requirement: Skill acts on the preflight's environment report

The skill body SHALL tell the agent that `%(TASKLESS_CLI)s agent ok` returns a recipe whose body reports whether the Taskless environment is up to date. When it reports the environment is up to date, the body SHALL instruct the agent to proceed with the user's request.

When it reports the environment is out of date, the body SHALL instruct the agent to give the user the steps that move the CLI or reinstall the skill, with their commands, once, for the user to run themselves, and SHALL NOT instruct the agent to run those steps. The body SHALL name the ways to run them: as the report says, with the harness's prefix when it names one, or in another terminal. The reason is that moving the CLI is the user's decision. The body SHALL instruct the agent to carry on with the user's request, and, when the user says they ran the steps, to run `%(TASKLESS_CLI)s agent ok` again to confirm.

When a step says the rules owe a reconcile and no CLI or skill step is left, the body SHALL instruct the agent to run its command and follow the recipe it prints to its last step, and to give the command to the user if it is refused. The body SHALL say that when the user declines an upgrade, the agent tells them what that means, and applies a reported rules step to this CLI.

That confirming run is the only time the body SHALL instruct the agent to run the preflight again in a session once it has passed.

A prefix offered here is distinct from the blocked-preflight guidance, which does not offer it. There, a prefix would clear only the one preflight call and leave every later Taskless command blocked. Here, the steps are one-off commands, and running them once is the whole job.

#### Scenario: Skill body explains both outcomes

- **WHEN** the skill body is read from source
- **THEN** it SHALL describe the up-to-date and the out-of-date outcomes of `agent ok`

#### Scenario: Skill body hands the steps to the user

- **WHEN** the skill body is read from source
- **THEN** it SHALL instruct the agent, on an out-of-date report, to give the user the steps that move the CLI or reinstall the skill once, to run themselves
- **AND** SHALL name the harness's prefix from the report and another terminal as the ways to run them
- **AND** SHALL NOT instruct the agent to run those steps itself
- **AND** SHALL instruct the agent to carry on with the user's request

#### Scenario: Skill body applies the rules step

- **WHEN** the skill body is read from source
- **THEN** it SHALL instruct the agent to run a rules step's command and follow its recipe once no CLI or skill step is left

#### Scenario: Skill body re-checks after the user updates

- **WHEN** the skill body is read from source
- **THEN** it SHALL instruct the agent, once the user says they ran the steps, to run `agent ok` again

#### Scenario: Skill body runs the preflight once otherwise

- **WHEN** the skill body is read from source
- **THEN** it SHALL NOT instruct the agent to run `agent ok` again in a session after it has passed, except to confirm the user's update
