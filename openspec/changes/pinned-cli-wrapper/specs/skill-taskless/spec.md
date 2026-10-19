## ADDED Requirements

### Requirement: Skill runs the launcher from the project root

The installed skill SHALL tell the agent to run every Taskless command from the project root, the directory that contains `.taskless/`, since the launcher's path is relative to it and a permission rule matches the command text, not the directory it runs in. When the agent's shell is elsewhere, the skill SHALL tell it to change into the project root in a separate shell call first, and then run the Taskless command on its own line, so the rule that a Taskless line carries no `cd` still holds. When more than one `.taskless/` directory exists above or around the working files, the skill SHALL name the nearest one containing the files the user is asking about as the project root.

The skill SHALL say that a "No such file or directory" error from the launcher means the shell is not at the project root, and that the fix is to change directory and rerun, not to call `npx` or `node` directly.

#### Scenario: The skill names the project root

- **WHEN** the installed skill is read
- **THEN** it SHALL say Taskless commands run from the directory that contains `.taskless/`
- **AND** it SHALL say to change directory in a separate shell call, never on the Taskless line

#### Scenario: A missing launcher is a directory problem

- **WHEN** the installed skill is read
- **THEN** it SHALL say a "No such file or directory" error from the launcher means the shell is not at the project root
- **AND** it SHALL NOT suggest running the CLI through `npx` or `node` instead
