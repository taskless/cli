## MODIFIED Requirements

### Requirement: ok topic confirms the CLI can run

`taskless agent ok` SHALL serve the recipe at `packages/cli/src/agent/ok.md` through the same render path as every other topic, and exit 0. Serving it at all confirms the CLI can run. The rendered recipe SHALL carry the `# Topic:` header and the one-command-per-call paragraph. It SHALL NOT carry the fetch-time directive, because the preflight runs once per session rather than once per task, and SHALL NOT carry a survey invite.

The recipe's body SHALL be one of two passages, chosen from the environment state the CLI measured when the recipe was fetched:

- When nothing is out of date: `Your Taskless environment is up to date and you can proceed.`
- When one or more parts are out of date: `Your Taskless environment is out of date, the following steps are needed in order for commands to work reliably:`, followed by one numbered step per out-of-date part, in the order cli, skill, rules. Each step SHALL name what is out of date, say why it matters, and give the exact command that fixes it, spelled with the detected invocation. After the steps, the passage SHALL tell the agent to give the steps to the user to run themselves, rather than running them, and to run `<invocation> agent ok` again once the user says they are done.

The three parts SHALL be decided as follows:

- **cli**: a newer version of the package this build is (`@taskless/cli` for a release build, `@taskless/cli-nightly` for a nightly) is published as `latest` than the running version, by semver precedence. The latest version SHALL be asked of the npm registry only, at most once per run, with a timeout of at most one second. The answer SHALL be used only when it is a strict semantic version (`MAJOR.MINOR.PATCH` with optional prerelease and build identifiers, and nothing else), because it is written into a command the user runs. A lookup that fails, times out, or returns a missing or invalid version SHALL leave this part out, and SHALL NOT change the output's form or the exit code. The lookup SHALL be skipped, and the part left out, in a CI environment, when `NO_UPDATE_NOTIFIER` is set to a non-empty value (the opt-out convention many CLIs honor), and on a build that is not a published package. The fixing command SHALL run `init` with that package at exactly the newer version.
- **skill**: the Taskless skill installed in the project is not the version this CLI carries, by the same comparison `taskless info` reports. The fixing command SHALL be `<invocation> init`. When the cli part is also present, the skill step SHALL say that the cli step's command also refreshes the skill and SHALL give no separate command.
- **rules**: the project's rules are not reconciled to this CLI, by the same status `taskless info` and `taskless init` report. The fixing command SHALL be `<invocation> update`.

In a directory with no `.taskless/`, the skill and rules parts SHALL be left out. The command MAY read `.taskless/`, and SHALL NOT create or write it.

When the recipe is rendered by a caller that supplies no measured state, as the `@taskless/cli/prompts` export does, the body SHALL say that the environment was not checked, and SHALL claim neither outcome.

It SHALL emit the command's `cli_agent` intent event with `topic: "ok"`. The topic SHALL appear in the `taskless agent` index.

#### Scenario: ok prints one confirmation line

- **WHEN** `taskless agent ok` is run in a project where nothing is out of date
- **THEN** stdout SHALL begin with the `# Topic: ok` header line
- **AND** SHALL contain `Your Taskless environment is up to date and you can proceed.`
- **AND** the CLI SHALL exit with code 0

#### Scenario: ok carries no fetch-time directive

- **WHEN** `taskless agent ok` is run
- **THEN** its output SHALL NOT contain the fetch-time directive

#### Scenario: ok names the detected invocation

- **WHEN** `taskless agent ok` is run by a launcher the CLI detects, and reports an out-of-date part
- **THEN** each fixing command SHALL be spelled with that launcher

#### Scenario: ok does not guess an unknown launcher

- **WHEN** `taskless agent ok` is run, the launcher cannot be determined, and an out-of-date part is reported
- **THEN** each fixing command SHALL be spelled with the same agent-fill marker every recipe uses for an unknown invocation, and SHALL NOT name a guessed launcher

#### Scenario: ok runs outside a Taskless project

- **WHEN** `taskless agent ok` is run in a directory with no `.taskless/`
- **THEN** it SHALL serve the recipe and exit 0
- **AND** SHALL report neither the skill nor the rules part
- **AND** SHALL NOT create `.taskless/`

#### Scenario: ok reports a newer published CLI

- **WHEN** `taskless agent ok` is run and the published `latest` for this build's package is newer than the running version
- **THEN** the output SHALL contain the out-of-date passage
- **AND** a step SHALL name the running version and the newer one
- **AND** SHALL give a command that runs `init` with that package at exactly the newer version

#### Scenario: The out-of-date passage hands the steps to the user

- **WHEN** `taskless agent ok` reports any out-of-date part
- **THEN** the output SHALL tell the agent to have the user run the steps
- **AND** SHALL tell the agent to run `<invocation> agent ok` again once the user is done

#### Scenario: A failed registry lookup is silent

- **WHEN** `taskless agent ok` is run, nothing local is out of date, and the registry lookup fails or exceeds its timeout
- **THEN** the output SHALL contain the up-to-date passage
- **AND** the CLI SHALL exit with code 0

#### Scenario: An invalid version is ignored

- **WHEN** `taskless agent ok` is run and the registry returns a `latest` that is not a strict semantic version
- **THEN** the cli part SHALL be left out
- **AND** the output SHALL NOT contain that string

#### Scenario: The registry is not asked in CI

- **WHEN** `taskless agent ok` is run in a CI environment, or with `NO_UPDATE_NOTIFIER` set
- **THEN** the CLI SHALL NOT contact the registry

#### Scenario: ok reports an out-of-date skill

- **WHEN** `taskless agent ok` is run in a project whose installed Taskless skill is not the version this CLI carries, and no newer CLI is reported
- **THEN** the output SHALL contain the out-of-date passage
- **AND** a step SHALL give `<invocation> init`

#### Scenario: A newer CLI subsumes the skill refresh

- **WHEN** `taskless agent ok` reports both the cli and skill parts
- **THEN** the skill step SHALL point to the cli step's command and SHALL give no command of its own

#### Scenario: ok reports rules owing a reconcile

- **WHEN** `taskless agent ok` is run in a project whose rules are not reconciled to this CLI
- **THEN** a step SHALL give `<invocation> update`

#### Scenario: ok does not write the project

- **WHEN** `taskless agent ok` is run in a project with a `.taskless/` directory
- **THEN** no file under `.taskless/` SHALL be created or modified

#### Scenario: The prompts export claims no outcome

- **WHEN** the `ok` recipe is rendered with no measured state
- **THEN** it SHALL say the environment was not checked
- **AND** SHALL contain neither the up-to-date nor the out-of-date passage

#### Scenario: ok is in the index

- **WHEN** `taskless agent` is run with no arguments
- **THEN** the index SHALL include a row for `ok`

#### Scenario: ok captures its topic

- **WHEN** `taskless agent ok` is run
- **THEN** PostHog SHALL receive a `cli_agent` event whose `topic` property is `ok`
