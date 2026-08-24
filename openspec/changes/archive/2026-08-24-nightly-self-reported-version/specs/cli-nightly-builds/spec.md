## ADDED Requirements

### Requirement: A nightly reports the version it is published as

A nightly build SHALL report, as its own CLI version, the version it is published under — not the released version declared by the package manifest in version control. This applies wherever the build states its version, including the version command, the CLI version embedded in recipe headers, telemetry, and the CLI version recorded when it installs into a project.

The version SHALL come from the same stamp used to name the published package, so that the version a nightly reports and the version an agent is sent to are the same string by construction rather than by coincidence.

A nightly build with no stamp available SHALL fail rather than report the committed version. Reporting the released version is the failure this requirement exists to prevent, and a build that cannot name itself has no correct value to substitute.

Builds other than nightly SHALL report the committed package version, which for those targets is the version they are.

#### Scenario: A nightly records its own version when it installs

- **WHEN** a nightly installs into a project
- **THEN** the CLI version recorded in the project manifest SHALL be the nightly's published version
- **AND** SHALL match the version pinned in the skills and commands emitted by that same install

#### Scenario: A nightly states its own version when asked

- **WHEN** a nightly is asked for its version
- **THEN** it SHALL report its published version rather than the released version its committed manifest declares

#### Scenario: A nightly build without a version stamp fails

- **WHEN** a nightly build is attempted with no version stamp available
- **THEN** the build SHALL fail
- **AND** SHALL NOT fall back to the committed package version

#### Scenario: A released build reports the committed version

- **WHEN** a non-nightly build is asked for its version
- **THEN** it SHALL report the version declared by the committed package manifest

#### Scenario: Reporting its own version does not modify the committed manifest

- **WHEN** a nightly build has run
- **THEN** the CLI package manifest in version control SHALL still declare the released version
