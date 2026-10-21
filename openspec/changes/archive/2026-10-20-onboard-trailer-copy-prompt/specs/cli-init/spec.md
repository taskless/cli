## MODIFIED Requirements

### Requirement: Init prints a post-install onboarding trailer

After a successful install (both wizard and `--no-interactive` paths), `taskless init` SHALL print a trailer pointing the user at the onboarding flow. The trailer SHALL be exactly two lines: one line of explanation, then a prompt the user can paste into their AI tool, `Onboard this project with Taskless`, alone on its own line. The prompt line SHALL carry no quotes, bullets, or prefix characters, so that selecting the whole line copies exactly the prompt. When colour is enabled the prompt line SHALL be coloured so it reads as the thing to copy; under `NO_COLOR` or a non-TTY stdout the same text SHALL print plain. The trailer SHALL be printed AFTER the install summary (the lines that report what was written and any obsolete files removed) and SHALL end the output before the process exits, its prompt line being the final line. Where another requirement says the onboarding trailer is the final line, it means this: the trailer ends the output, with its prompt line last. The trailer SHALL NOT be gated on the value of `install.onboarded` in the manifest — it is informational, printed every successful install. The trailer's wording SHALL be the same for every install plan: every installed target receives the Taskless skill, so the explanation line SHALL name the Taskless skill and the prompt SHALL ask the AI tool to onboard with Taskless, and SHALL NOT mention `/tskl onboard` or a terminal `taskless onboard` command. The trailer SHALL be suppressed when `taskless init` exits non-zero (cancelled wizard, install failure, etc.) or when the install was a no-op (no targets selected, no files to write).

#### Scenario: Wizard install points at the skill only

- **WHEN** a user runs `taskless init` in an interactive terminal and the wizard completes successfully
- **THEN** the output SHALL end with the trailer: an explanation line naming the Taskless skill, then `Onboard this project with Taskless` as the final line
- **AND** the trailer SHALL NOT mention `/tskl onboard` or `taskless onboard`

#### Scenario: Non-interactive install points at the skill only

- **WHEN** a user runs `taskless init --no-interactive`, whatever tools are detected
- **THEN** the output SHALL end with the same skill-only trailer, its prompt as the final line
- **AND** SHALL NOT mention `/tskl onboard` or `taskless onboard`

#### Scenario: The prompt line is coloured on a colour terminal

- **WHEN** the trailer is printed to a colour terminal
- **THEN** the prompt line SHALL be coloured and its visible text SHALL be exactly `Onboard this project with Taskless`

#### Scenario: The prompt line prints plain without colour

- **WHEN** the trailer is printed under `NO_COLOR` or to a non-TTY stdout
- **THEN** the prompt line SHALL be exactly `Onboard this project with Taskless`, with no escape sequences, quotes, bullets, or prefix

#### Scenario: Cancelled wizard suppresses the trailer

- **WHEN** a user cancels the wizard (Ctrl-C or equivalent)
- **THEN** the trailer SHALL NOT be printed

#### Scenario: Failed install suppresses the trailer

- **WHEN** `taskless init` exits non-zero due to an install failure
- **THEN** the trailer SHALL NOT be printed

#### Scenario: Trailer is printed regardless of onboarded state

- **WHEN** a user re-runs `taskless init` and `install.onboarded` is already `true`
- **THEN** the trailer SHALL still be printed
- **AND** the trailer wording SHALL be the same skill-only trailer
