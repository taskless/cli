## MODIFIED Requirements

### Requirement: The CLI runs only as the version the project recorded

When `.taskless/taskless.json` records a version for the package the running CLI belongs to, the CLI SHALL refuse to run any subcommand other than `init`, `info`, `auth`, and `feedback` unless its own version equals that recorded version. The recorded version for a package SHALL be the version that package's project launcher runs: its `install.launchers` entry. `install.cliVersion` records only the build that last installed, for display, and SHALL NOT be read as any package's version; scaffold migration 13 moves a legacy one into `install.launchers`. The package the running CLI belongs to SHALL be taken from its build target, not read from its version.

`init` is exempt because it is the command that moves the recorded version. `info`, `auth`, and `feedback` are exempt because they read no rules and serve no recipes, and `info` is where a reader diagnoses the refusal. A bare invocation with no subcommand, `--help`, and `--version` SHALL NOT be refused.

The refusal SHALL apply however the CLI was started, including npx, `pnpm dlx`, a package installed under `node_modules`, and a project launcher. It SHALL exit non-zero with the error code `CLI_VERSION_MISMATCH`, SHALL name the running version and the recorded version, and SHALL name the remedy: running the project launcher, which runs the recorded version, or, when the running CLI is newer, running `init` with it to move the project to it. With `--json` set, the refusal SHALL be printed as the standard error envelope on stdout.

The CLI SHALL NOT refuse when the project has no readable `taskless.json`, when the manifest records no version at all, or when the running build is a development (`self`) build, which has no published version to match. A manifest that records a version only for the other package (a release CLI in a project that recorded only a nightly, or the reverse) SHALL be refused.

#### Scenario: A newer CLI started through npx is refused

- **WHEN** a project's manifest records `install.launchers["@taskless/cli"]` as `0.13.2`
- **AND** a user runs `npx @taskless/cli@0.14.0 check` in that project
- **THEN** the CLI SHALL exit non-zero with `CLI_VERSION_MISMATCH` without scanning
- **AND** the message SHALL name `0.14.0`, `0.13.2`, the project launcher, and `init`

#### Scenario: An older pinned CLI is refused

- **WHEN** the manifest records `0.14.0` for `@taskless/cli`
- **AND** CI runs `@taskless/cli` `0.13.2` from `node_modules`
- **THEN** any gated subcommand SHALL exit non-zero with `CLI_VERSION_MISMATCH`

#### Scenario: init moves the pin

- **WHEN** the manifest records `0.13.2` and a user runs `npx @taskless/cli@0.14.0 init --no-interactive`
- **THEN** `init` SHALL run
- **AND** a following `check` through the project launcher SHALL NOT be refused by this gate

#### Scenario: Exempt subcommands run on any version

- **WHEN** the running version does not match the recorded version
- **THEN** `info`, `auth status`, `feedback`, `--help`, and `--version` SHALL run normally

#### Scenario: A project with no recorded version is not gated

- **WHEN** the project has no `.taskless/taskless.json`, or its manifest records no version under `install.launchers`
- **THEN** every subcommand SHALL run on any version

#### Scenario: A self install does not gate the published builds

- **WHEN** the manifest records `install.cliVersion` as `0.13.0-self` and no `install.launchers`, as a self install over a legacy manifest leaves it
- **THEN** a nightly CLI and a release CLI SHALL each run gated subcommands without `CLI_VERSION_MISMATCH`

#### Scenario: A JSON caller gets the envelope

- **WHEN** a gated subcommand is refused with `--json` set
- **THEN** stdout SHALL hold `{"ok": false, "code": "CLI_VERSION_MISMATCH", "message": ...}`

#### Scenario: A cliVersion with no launchers record is not read

- **WHEN** the manifest records `install.cliVersion` as `0.13.2` and no `install.launchers`
- **THEN** `npx @taskless/cli@0.14.0 check` SHALL NOT be refused with `CLI_VERSION_MISMATCH`
