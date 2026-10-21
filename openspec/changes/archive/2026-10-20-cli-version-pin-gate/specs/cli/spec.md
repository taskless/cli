## ADDED Requirements

### Requirement: The CLI runs only as the version the project recorded

When `.taskless/taskless.json` records a version for the package the running CLI belongs to, the CLI SHALL refuse to run any subcommand other than `init`, `info`, `auth`, and `feedback` unless its own version equals that recorded version. The recorded version for a package SHALL be its `install.launchers` entry, falling back to `install.cliVersion` when that value belongs to the package (a nightly version has a prerelease part, a release version has none), which is the same version that package's project launcher runs.

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

- **WHEN** the project has no `.taskless/taskless.json`, or its manifest records neither `install.launchers` nor `install.cliVersion`
- **THEN** every subcommand SHALL run on any version

#### Scenario: A JSON caller gets the envelope

- **WHEN** a gated subcommand is refused with `--json` set
- **THEN** stdout SHALL hold `{"ok": false, "code": "CLI_VERSION_MISMATCH", "message": ...}`

### Requirement: Rule-running commands refuse rules reconciled against other engine versions

`check` and `verify` SHALL refuse to run when `rules.engines` in `taskless.json` records a version for an engine that differs from the version of that engine this CLI bundles, and the project has at least one rule for that engine. They SHALL exit non-zero with the error code `RULES_ENGINE_MISMATCH` before running any engine, and the message SHALL name each differing engine with its recorded and bundled versions.

When a recorded engine is older than the bundled one, the message SHALL direct the reader to the ledger walk (`update`) followed by `update --rules`, which applies any rule migrations and records the bundled engines. When a recorded engine is newer, the message SHALL direct the reader to the CLI the project recorded, since the rules were reconciled by a newer CLI than this one.

An engine the manifest does not record, and an engine with no rules in the project, SHALL NOT cause a refusal: a project that never recorded a reconciliation has no claim to compare against, and an engine with no rules has nothing that could run wrongly.

#### Scenario: Rules behind the bundled engine are refused

- **WHEN** `rules.engines.sg` is `0.45.3`, this CLI bundles ast-grep `0.51.0`, and the project has an ast-grep rule
- **THEN** `check` SHALL exit non-zero with `RULES_ENGINE_MISMATCH` and run no engine
- **AND** the message SHALL name ast-grep `0.45.3` and `0.51.0` and `update --rules`

#### Scenario: Rules ahead of the bundled engine are refused

- **WHEN** `rules.engines.vale` is newer than the Vale this CLI bundles and the project has a Vale rule
- **THEN** `verify` SHALL exit non-zero with `RULES_ENGINE_MISMATCH`
- **AND** the message SHALL say the rules were reconciled by a newer CLI

#### Scenario: An engine without rules is not compared

- **WHEN** `rules.engines.vale` differs from the bundled Vale and the project has no Vale rules
- **THEN** `check` SHALL NOT refuse on account of Vale

#### Scenario: A project that never recorded engines is not gated

- **WHEN** the manifest has no `rules.engines`
- **THEN** `check` and `verify` SHALL run as before

#### Scenario: Reconciling clears the refusal

- **WHEN** `check` was refused because the rules were behind
- **AND** the user runs `update --rules`
- **THEN** a following `check` SHALL NOT be refused by this gate

### Requirement: The version mismatch override has an environment form

`--allow-version-mismatches` SHALL skip the version-pin gate and the engine-version gate as well as the scaffold-version refusal it already skips. The environment variable `TASKLESS_ALLOW_VERSION_MISMATCHES`, set to `1` or `true`, SHALL have the same effect as the flag, so a script that runs a deliberately unpinned build can set it once.

#### Scenario: The flag skips both new gates

- **WHEN** the running version does not match the recorded version, the recorded engines differ from the bundled ones, and the user runs `check --allow-version-mismatches`
- **THEN** `check` SHALL run

#### Scenario: The environment variable is equivalent

- **WHEN** `TASKLESS_ALLOW_VERSION_MISMATCHES=1` is set and the versions do not match
- **THEN** the CLI SHALL behave as though `--allow-version-mismatches` were passed
