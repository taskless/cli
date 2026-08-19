## ADDED Requirements

### Requirement: Unreleased work on the default branch is installable as a nightly package

The CLI SHALL be published as `@taskless/cli-nightly` from commits on the default branch that carry unreleased work, so that merged-but-unreleased behavior can be installed and exercised. Nightlies SHALL NOT be published from pull requests: only code that has already merged, and therefore already passed review, is eligible.

The nightly SHALL be built from the same source and the same build as the release it anticipates, differing only in the published package name and version. Its executable SHALL remain `taskless`, so every documented invocation works unchanged against a nightly.

#### Scenario: A push to the default branch with unreleased work publishes a nightly

- **WHEN** a commit is pushed to the default branch and release-pending metadata exists for the CLI
- **THEN** `@taskless/cli-nightly` SHALL be published for that commit

#### Scenario: A pull request publishes nothing

- **WHEN** a pull request is opened, updated, or synchronized
- **THEN** no nightly SHALL be published, and no job holding a publishing credential SHALL be instantiated for it

#### Scenario: A nightly is a drop-in for the release it anticipates

- **WHEN** a nightly is installed
- **THEN** it SHALL provide the `taskless` executable
- **AND** it SHALL resolve the same pinned platform dependencies as the corresponding release

### Requirement: A nightly version names the release it anticipates, the time, and the commit

A nightly version SHALL take the form `<n.m.k>-<yyyymmddhhmmss>x<sha>`, where `n.m.k` is the version the default branch's pending release metadata proposes, `yyyymmddhhmmss` is the build time, and `sha` is the short commit hash.

The timestamp SHALL precede the commit hash, so that lexical comparison of the prerelease identifier orders builds chronologically. The prerelease identifier SHALL contain a non-digit separator between the timestamp and the hash, so that the identifier is never all-digits — an all-digit prerelease identifier is compared numerically and may not begin with a zero, which a hash beginning with `0` would otherwise violate.

#### Scenario: A nightly version is stamped

- **WHEN** pending release metadata proposes `0.11.0`, the build time is `2026-08-18T12:34:56Z`, and the short commit hash is `05b3c88`
- **THEN** the published version SHALL be `0.11.0-20260818123456x05b3c88`

#### Scenario: A hash beginning with zero produces a valid version

- **WHEN** the short commit hash consists only of digits and begins with `0`
- **THEN** the published version SHALL still be a valid semantic version

#### Scenario: Nightlies sort chronologically

- **WHEN** two nightlies of the same `n.m.k` are compared
- **THEN** the one built later SHALL sort after the one built earlier

### Requirement: A nightly is installable by default

Every nightly version is a semantic-version prerelease, which a registry does not place on the default install tag on its own. Publishing SHALL therefore explicitly assign the default tag, so that installing the package without a version installs the most recent nightly.

#### Scenario: Installing without a version resolves the latest nightly

- **WHEN** `@taskless/cli-nightly` is installed with no version or tag specified
- **THEN** the most recently published nightly SHALL be installed

### Requirement: A nightly build is bounded by pending release metadata and by the commit

Two gates SHALL decide whether a nightly is built, evaluated in this order.

First, whether any release metadata is pending. When none is pending, nothing is unreleased, there is no proposed version to name, and no nightly SHALL be built. This gate SHALL be evaluated before any dependency installation, so the common case exits at the cheapest possible point.

Second, whether this commit already has a nightly. Published versions SHALL be queried and tested for one whose prerelease identifier ends with the short commit hash; if one exists, no nightly SHALL be built.

The proposed `n.m.k` SHALL be read from the release tool's structured output file rather than from its console output, which also carries unrelated diagnostics.

#### Scenario: Nothing pending publishes nothing

- **WHEN** a commit is pushed to the default branch and no release metadata is pending
- **THEN** no nightly SHALL be published
- **AND** the run SHALL exit before installing dependencies

#### Scenario: The release merge publishes the release and no nightly

- **WHEN** the version pull request merges, consuming all pending release metadata and bumping the package version
- **THEN** the real release SHALL be published
- **AND** no nightly SHALL be published, with no rule special-casing that commit

#### Scenario: A re-run of an already-built commit publishes nothing

- **WHEN** the nightly flow runs again for a commit that already has a published nightly
- **THEN** no nightly SHALL be published

#### Scenario: A chore commit alongside pending work still yields a nightly

- **WHEN** a commit that changes no CLI source is pushed while release metadata is pending
- **THEN** a nightly SHALL be published for that commit, because the commit — and therefore the artifact it describes — is new

### Requirement: Nightlies do not enter the released package's history

Nightlies SHALL be published under a package name distinct from the released CLI, so that the released package's version history contains only releases. The rename SHALL be applied when the publishable artifact is produced, leaving the package manifest in version control unchanged.

#### Scenario: The released package carries no nightly versions

- **WHEN** the published versions of the released CLI package are listed
- **THEN** no nightly version SHALL appear among them

#### Scenario: The committed manifest is unchanged

- **WHEN** the repository is inspected after a nightly is published
- **THEN** the CLI package manifest in version control SHALL still declare the released package name and version

### Requirement: A nightly publish carries the same attestation as a release

Nightly publishing SHALL authenticate with a short-lived credential minted for the run rather than a stored registry token, and SHALL attach build provenance.

#### Scenario: A nightly is published with provenance

- **WHEN** a nightly is published
- **THEN** the published version SHALL carry a build-provenance attestation
- **AND** no long-lived registry token SHALL be present in the environment
