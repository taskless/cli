## MODIFIED Requirements

### Requirement: All capture calls include standard properties

Every `capture()` call SHALL include the `cli` property (anonymous UUID), the `cliVersion` property (the version the build reports as its own, baked in at build time), and the `scaffoldVersion` property (the `version` field from `.taskless/taskless.json`, or `0` if the manifest is absent or unreadable). When authenticated, the `groups` parameter SHALL include `{ organization: String(orgId) }`. The `cliVersion` and `scaffoldVersion` values SHALL be resolved once at telemetry initialization and attached to every subsequent `capture()` call without re-reading the source files.

#### Scenario: Anonymous capture includes standard properties

- **WHEN** `capture("cli_run")` is called without authentication
- **THEN** the event SHALL include `{ cli: anonymousUuid, cliVersion: <string>, scaffoldVersion: <number> }`
- **AND** the event SHALL NOT include a `groups` parameter

#### Scenario: Authenticated capture includes standard properties and group

- **WHEN** `capture("cli_rule_created")` is called with authentication
- **THEN** the event SHALL include `{ cli: anonymousUuid, cliVersion: <string>, scaffoldVersion: <number> }`
- **AND** the `groups` parameter SHALL include `{ organization: String(orgId) }`

#### Scenario: Scaffold version falls back to 0 when manifest missing

- **WHEN** `getTelemetry(cwd)` is initialized in a directory with no `.taskless/taskless.json`
- **THEN** every `capture()` call from the returned client SHALL include `scaffoldVersion: 0`

#### Scenario: CLI version is the version the build reports as its own

- **WHEN** `getTelemetry()` is initialized
- **THEN** `cliVersion` SHALL be the version the build reports as its own, bundled at build time
- **AND** for every build target but `nightly` that SHALL be the version in `packages/cli/package.json`
- **AND** for a `nightly` it SHALL be the version the nightly is published under, so events are attributed to the build that emitted them rather than to the release it anticipates
- **AND** SHALL be attached to every event emitted through the returned client
