## ADDED Requirements

### Requirement: Migration 13 records a legacy cliVersion in launchers

Migration `13` SHALL move a version recorded only as `install.cliVersion` into `install.launchers`, under the package that published it, so that the CLI and the project launcher read `install.launchers` alone. A version with no prerelease part belongs to `@taskless/cli`. A version ending in `-self` (a development build run from a path) belongs to no package and SHALL record nothing. Any other prerelease belongs to `@taskless/cli-nightly`, which covers a published nightly (`<base>-<stamp>x<sha>`) and a `build:next` one (`<next>-next-<sha>`). A value that is not a version SHALL record nothing.

The migration SHALL keep `install.cliVersion`, which still records the build that last installed, and SHALL preserve every other field of the manifest, in `install` and outside it. It SHALL leave a manifest whose `install.launchers` already records any version untouched, so it is idempotent and a crash after its write replays as a no-op. A missing or unparseable manifest, or one without an `install` object, SHALL be left as it is. The migration SHALL NOT modify any shipped migration.

An older CLI that predates this migration refuses a project at scaffold version 13 as newer than it understands. That is accepted.

#### Scenario: A legacy release version is moved

- **WHEN** `taskless.json` records version 12 and `install` is `{ "cliVersion": "0.13.0" }`, and the CLI bootstraps `.taskless/`
- **THEN** migration 13 SHALL run
- **AND** `install.launchers` SHALL be `{ "@taskless/cli": "0.13.0" }`
- **AND** `install.cliVersion` SHALL still be `0.13.0`
- **AND** `taskless.json` SHALL record version 13

#### Scenario: A legacy nightly version is moved

- **WHEN** migration 13 runs on `install.cliVersion` `0.14.0-20261020120000xabc1234` or `0.13.0-next-fa9ae7c`, with no `install.launchers`
- **THEN** `install.launchers` SHALL record that version under `@taskless/cli-nightly`

#### Scenario: A self build's version records nothing

- **WHEN** migration 13 runs on `install.cliVersion` `0.13.0-self`, with no `install.launchers`
- **THEN** the manifest SHALL be unchanged

#### Scenario: A recorded launcher map is left alone

- **WHEN** `install.launchers` records `@taskless/cli` at `0.13.0` and `install.cliVersion` is `0.14.0-20261020120000xabc1234`
- **THEN** migration 13 SHALL leave the manifest unchanged

#### Scenario: Migration 13 is idempotent

- **WHEN** migration 13 has run and runs again
- **THEN** the manifest SHALL be byte-for-byte unchanged by the second run
