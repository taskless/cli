## ADDED Requirements

### Requirement: Telemetry is disabled by project configuration

A top-level `"telemetry": false` in `.taskless/taskless.json` SHALL cause `getTelemetry(cwd)` to return the same inert stub as the environment opt-out. No PostHog client SHALL be created, no network requests SHALL be made, no anonymous ID file SHALL be read or written, and no git subprocess SHALL be spawned. Reading the manifest SHALL be the only work done. Only the JSON value `false` SHALL disable telemetry; any other value, an absent key, or an unreadable manifest SHALL leave it enabled. The environment variables SHALL be checked first, so either opt-out alone is sufficient. `isTelemetryEnabled(cwd)` SHALL apply the same rule, so every caller that gates work on telemetry honors the manifest.

#### Scenario: Manifest opt-out disables telemetry

- **WHEN** `.taskless/taskless.json` contains `"telemetry": false`
- **AND** `getTelemetry(cwd)` is called with that project directory
- **THEN** it SHALL return a no-op stub
- **AND** no PostHog client SHALL be instantiated
- **AND** no anonymous ID file SHALL be written

#### Scenario: Only false opts out

- **WHEN** `.taskless/taskless.json` contains `"telemetry"` set to `true`, `"false"`, `0`, or `null`
- **THEN** `getTelemetry(cwd)` SHALL create a real PostHog client

#### Scenario: The survey invite honors the manifest opt-out

- **WHEN** a surveyed recipe is served in a project whose manifest contains `"telemetry": false`
- **THEN** the survey invite SHALL NOT be appended
