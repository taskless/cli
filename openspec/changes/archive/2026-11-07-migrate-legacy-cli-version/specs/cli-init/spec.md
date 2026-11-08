## MODIFIED Requirements

### Requirement: Init installs the package's launcher and records its version

Every `init` that writes the canonical skill, in the wizard and in `--no-interactive`, SHALL also write this build's launcher, as defined by the `cli-project-launcher` capability, and record this build's version for its package under `install.launchers` in `.taskless/taskless.json`, keyed by package name. `install.cliVersion` SHALL keep recording the build that last installed.

A nightly `init` SHALL keep the release's recorded version. Where the release's version was recorded only as `install.cliVersion` (a manifest written before `install.launchers` existed), scaffold migration 13, which `init` runs before installing, moves it into `install.launchers`, so `.taskless/bin/cli.mjs` keeps a version to run after `install.cliVersion` is overwritten. The install itself SHALL read only `install.launchers`.

A release `init` is the move back to mainline, and SHALL retire the nightly: it SHALL drop `@taskless/cli-nightly` from `install.launchers`, and remove `.taskless/bin/cli-nightly.mjs` and `.taskless/bin/cli-nightly.lock.json` when they exist. The cached nightly build is then pruned, since nothing records it. Each file removed SHALL be named in the install summary and listed in `init --json` as `retired`, an array of root-relative paths present on every successful run and empty when nothing was removed, and a removal SHALL count as a change. The release `init` SHALL NOT touch the user-level global trust entry, which other projects may still use.

A launcher whose bytes differ from this build's launcher SHALL be rewritten, and the install summary SHALL name it as restored, since a launcher runs whatever it contains under any rule that allows it. A `self` build SHALL write no launcher, record no version under `install.launchers`, and retire nothing.

The launcher and its record are install output, written by the same step as the canonical skill. The one scaffold migration involved, migration 13, only moves a legacy `install.cliVersion` into the record; it writes no launcher.

#### Scenario: A release install records its version

- **WHEN** `init` runs from the release at `0.13.0` in a project with no `install.launchers`
- **THEN** `install.launchers` SHALL be `{ "@taskless/cli": "0.13.0" }`
- **AND** `install.cliVersion` SHALL be `0.13.0`

#### Scenario: A nightly install keeps the release's version

- **WHEN** `install.launchers` is `{ "@taskless/cli": "0.13.0" }` and a nightly `init` runs at `0.14.0-20261020120000xabc1234`
- **THEN** `install.launchers` SHALL be `{ "@taskless/cli": "0.13.0", "@taskless/cli-nightly": "0.14.0-20261020120000xabc1234" }`
- **AND** `install.cliVersion` SHALL be `0.14.0-20261020120000xabc1234`

#### Scenario: A nightly install keeps a release version only cliVersion recorded

- **WHEN** `.taskless/taskless.json` records scaffold version 12, `install.cliVersion` `0.13.0` and no `install.launchers`, and a nightly `init` runs at `0.14.0-20261020120000xabc1234`
- **THEN** `install.launchers` SHALL be `{ "@taskless/cli": "0.13.0", "@taskless/cli-nightly": "0.14.0-20261020120000xabc1234" }`

#### Scenario: A release install retires the nightly

- **WHEN** `install.launchers` records `@taskless/cli-nightly`, `.taskless/bin/cli-nightly.mjs` and `cli-nightly.lock.json` exist, and the release's `init` runs at `0.13.0`
- **THEN** `install.launchers` SHALL be `{ "@taskless/cli": "0.13.0" }`
- **AND** both nightly files SHALL be gone and listed in `retired`
- **AND** the nightly's cache entry SHALL be pruned

#### Scenario: An edited launcher is restored and reported

- **WHEN** `.taskless/bin/cli.mjs` was edited and the release's `init` runs
- **THEN** the file SHALL hold this build's launcher afterwards
- **AND** the summary SHALL name `.taskless/bin/cli.mjs` as restored
