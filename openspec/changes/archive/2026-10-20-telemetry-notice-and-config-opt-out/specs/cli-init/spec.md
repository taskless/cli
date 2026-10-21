## ADDED Requirements

### Requirement: Install discloses telemetry

Both install paths SHALL disclose telemetry once per run, and only when telemetry is enabled for the project.

A completed wizard run, and a human-readable `init` run, SHALL print one notice that Taskless collects anonymous telemetry, naming the `TASKLESS_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1` environment variables and the `"telemetry": false` setting in `.taskless/taskless.json`. In `init` the notice SHALL come before the onboarding trailer, which stays the final line. When telemetry is disabled for the project, by environment or by manifest, neither path SHALL print it.

`init --json` SHALL NOT print the notice. Its envelope SHALL instead always carry `telemetry: { enabled: boolean }`, so the agent reading it can relay the notice.

#### Scenario: Wizard shows the notice when telemetry is on

- **WHEN** the wizard completes with telemetry enabled
- **THEN** the output SHALL contain the telemetry notice exactly once

#### Scenario: init shows the notice when telemetry is on

- **WHEN** `init` runs without `--json` and telemetry is enabled
- **THEN** stdout SHALL contain the telemetry notice exactly once
- **AND** the onboarding trailer SHALL remain the last line

#### Scenario: Notice is omitted when telemetry is off

- **WHEN** the wizard or `init` completes with telemetry disabled by environment or manifest
- **THEN** the output SHALL NOT contain the telemetry notice

#### Scenario: init --json reports whether telemetry is on

- **WHEN** `init --json` runs
- **THEN** the envelope SHALL contain `telemetry.enabled`, `true` when telemetry is enabled and `false` otherwise
- **AND** stdout SHALL NOT contain the telemetry notice
