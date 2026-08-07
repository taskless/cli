## ADDED Requirements

### Requirement: The CLI declares Vale platform packages as optional dependencies

`packages/cli` SHALL declare every supported Vale platform package in `optionalDependencies`, so that installing the CLI also installs the Vale binary matching the host. Each SHALL be pinned to a literal exact version rather than a range or a workspace protocol, so that a newly published platform package reaches the CLI only through a deliberate change.

The declaration SHALL NOT be a `devDependency`, which would not be installed for consumers of the CLI. `optionalDependencies` is required so an unsupported host installs the CLI successfully with no platform package present.

#### Scenario: Installing the CLI brings the host's Vale binary

- **WHEN** the CLI is installed on a supported platform
- **THEN** the matching Vale platform package is installed alongside it and the binary is resolvable from the CLI's module context

#### Scenario: Unsupported platform still installs

- **WHEN** the CLI is installed on a platform with no published Vale package
- **THEN** the install succeeds with no platform package present, and no error is raised at install time

#### Scenario: Versions are pinned exactly

- **WHEN** the CLI's `optionalDependencies` are inspected in a published tarball
- **THEN** each Vale platform package is pinned to a single exact version, not a range or workspace protocol

#### Scenario: A newer platform package does not change the CLI

- **WHEN** a platform package is published for a newer upstream Vale release and the CLI's pin is unchanged
- **THEN** the CLI continues to resolve the pinned version
