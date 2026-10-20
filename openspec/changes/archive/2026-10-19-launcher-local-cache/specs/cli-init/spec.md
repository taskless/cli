## ADDED Requirements

### Requirement: Init writes the package's lockfile beside its launcher

Every `init` that writes a launcher SHALL also write this build's lockfile for the same package beside it: `.taskless/bin/cli.lock.json` for the release and `.taskless/bin/cli-nightly.lock.json` for the nightly. It SHALL NOT write, change or remove the other package's lockfile. A lockfile whose bytes differ from this build's SHALL be rewritten, and the install summary SHALL name it as restored. A `self` build SHALL write no lockfile. No scaffold migration SHALL be added for this.

#### Scenario: A release install writes its lockfile

- **WHEN** the release's `init` runs at `0.13.1`
- **THEN** `.taskless/bin/cli.lock.json` SHALL hold this build's lockfile, naming `@taskless/cli` at `0.13.1`

#### Scenario: A nightly install leaves the release's lockfile alone

- **WHEN** `.taskless/bin/cli.lock.json` exists and a nightly `init` runs
- **THEN** `.taskless/bin/cli-nightly.lock.json` SHALL be written
- **AND** `.taskless/bin/cli.lock.json` SHALL be unchanged

#### Scenario: An edited lockfile is restored and reported

- **WHEN** `.taskless/bin/cli.lock.json` was edited and the release's `init` runs
- **THEN** the file SHALL hold this build's lockfile afterwards
- **AND** the summary SHALL name it as restored

### Requirement: Init removes cached CLI versions nothing records

After `init` records versions under `install.launchers`, it SHALL remove every entry in `.taskless/.cache/` that is not the version recorded for either package, and every temporary install directory more than an hour old, by the same rule the launcher uses. Removal SHALL be best effort: an entry that cannot be removed SHALL be left without failing `init`. `init` SHALL NOT install anything into `.taskless/.cache/`; the launcher does that on its first run.

#### Scenario: An upgrade drops the previous release

- **WHEN** `.taskless/.cache/` holds `@taskless/cli@0.13.0` and the release's `init` runs at `0.13.1`
- **THEN** `@taskless/cli@0.13.0` SHALL no longer be in the cache
- **AND** nothing SHALL be installed for `0.13.1`

#### Scenario: A nightly install keeps the release's cache

- **WHEN** `.taskless/.cache/` holds `@taskless/cli@0.13.0`, `install.launchers` records it, and a nightly `init` runs
- **THEN** `@taskless/cli@0.13.0` SHALL remain in the cache
