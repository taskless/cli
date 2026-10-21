## MODIFIED Requirements

### Requirement: Each package has its own launcher

The release package SHALL install its launcher at `.taskless/bin/cli.mjs`, and the nightly package at `.taskless/bin/cli-nightly.mjs`. A build SHALL write and rewrite only its own package's launcher. A nightly build SHALL NEVER read, edit, or remove the release's launcher, so a nightly installs beside the release. A release build SHALL NOT read or edit the nightly's launcher, and SHALL remove it when it installs, because installing the release is the move back to mainline. A build whose invocation names neither package, such as a `self` build, SHALL write no launcher and remove none.

Each launcher SHALL be an ES module (`.mjs`) whose first line is `#!/usr/bin/env node`, and SHALL be written with its executable bits set where the filesystem supports them. Its content SHALL be identical for every version of its package, so an upgrade never changes its bytes unless the launcher itself changed.

#### Scenario: The release installs cli.mjs

- **WHEN** `init` runs from the release package
- **THEN** `.taskless/bin/cli.mjs` SHALL exist, begin with `#!/usr/bin/env node`, and be executable
- **AND** `.taskless/bin/cli-nightly.mjs` SHALL NOT be created

#### Scenario: A nightly leaves the release's launcher alone

- **WHEN** `.taskless/bin/cli.mjs` exists and `init` runs from a nightly
- **THEN** `.taskless/bin/cli.mjs` SHALL be byte-identical afterwards
- **AND** `.taskless/bin/cli-nightly.mjs` SHALL exist

#### Scenario: The release removes the nightly's launcher

- **WHEN** `.taskless/bin/cli-nightly.mjs` exists and `init` runs from the release
- **THEN** `.taskless/bin/cli-nightly.mjs` SHALL NOT exist afterwards
- **AND** `.taskless/bin/cli.mjs` SHALL exist

#### Scenario: An upgrade does not rewrite an unchanged launcher

- **WHEN** `init` runs at `0.13.1` over a project installed at `0.13.0`, and the launcher template did not change between them
- **THEN** the launcher's bytes SHALL be unchanged
