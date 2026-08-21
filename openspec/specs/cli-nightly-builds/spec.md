# cli-nightly-builds Specification

## Purpose

TBD - created by archiving change nightly-cli-builds. Update Purpose after archive.

## Requirements

### Requirement: Unreleased work on the default branch is installable as a nightly package

The CLI SHALL be published as `@taskless/cli-nightly` from commits on the default branch that carry unreleased work, so that merged-but-unreleased behavior can be installed and exercised. Nightlies SHALL NOT be published from pull requests: only code that has already merged, and therefore already passed review, is eligible.

The nightly SHALL be built from the same source and the same build as the release it anticipates, differing only in the published package name and version. Its executable SHALL remain `taskless`, so every documented invocation works unchanged against a nightly.

#### Scenario: A validated push to the default branch with unreleased work publishes a nightly

- **WHEN** a commit is pushed to the default branch, the repository's validation suite passes for that commit, and release-pending metadata exists for the CLI
- **THEN** `@taskless/cli-nightly` SHALL be published for that commit

#### Scenario: A pull request publishes nothing

- **WHEN** a pull request is opened, updated, or synchronized
- **THEN** no nightly SHALL be published, and no job holding a publishing credential SHALL be instantiated for it

#### Scenario: A nightly is a drop-in for the release it anticipates

- **WHEN** a nightly is installed
- **THEN** it SHALL provide the `taskless` executable
- **AND** it SHALL resolve the same pinned platform dependencies as the corresponding release

### Requirement: A nightly's shipped instructions name the nightly package

The skills, commands, and recipes a nightly installs SHALL instruct an agent to invoke the nightly package, pinned to the version that shipped them, rather than the released package. A nightly is installed to exercise unreleased behavior; instructions naming the released package would send the agent to a different build with nothing reporting an error.

The version named in those instructions SHALL be the same version the nightly is published under. It SHALL therefore be determined once and supplied to both the build and the packaging step, and the packaging step SHALL NOT be able to determine it independently — a version determined twice is determined from two different clocks, and the instructions would name a version that was never published.

When a nightly build is requested without a valid version, the build SHALL fail. It SHALL NOT emit instructions naming the released package.

#### Scenario: A nightly's recipes name the nightly package

- **WHEN** an agent requests a recipe from an installed nightly
- **THEN** the rendered recipe SHALL invoke the nightly package at the version that nightly was published under

#### Scenario: The published version and the instructed version agree

- **WHEN** a nightly is published
- **THEN** the version its shipped instructions name SHALL be the version it was published under

#### Scenario: A nightly build without a valid version fails

- **WHEN** a nightly build is requested and no valid version is supplied
- **THEN** the build SHALL fail with an error naming the missing input

### Requirement: A nightly version names the release it anticipates, the time, and the commit

A nightly version SHALL take the form `<n.m.k>-<yyyymmddhhmmss>x<sha>`, where `n.m.k` is the version the default branch's pending release metadata proposes, `yyyymmddhhmmss` is the build time, and `sha` is the short commit hash.

The pending release metadata describes every package it releases, so `n.m.k` SHALL be selected by matching the CLI package's name, and SHALL NOT be taken by position. Position is correct only while the CLI is the sole package under release management, and a version taken from another package publishes successfully while naming a release that was never proposed.

The timestamp SHALL precede the commit hash, so that lexical comparison of the prerelease identifier orders builds chronologically. The prerelease identifier SHALL contain a non-digit separator between the timestamp and the hash, so that the identifier is never all-digits — an all-digit prerelease identifier is compared numerically and may not begin with a zero, which a hash beginning with `0` would otherwise violate.

#### Scenario: A nightly version is stamped

- **WHEN** pending release metadata proposes `0.11.0`, the build time is `2026-08-18T12:34:56Z`, and the short commit hash is `05b3c88`
- **THEN** the published version SHALL be `0.11.0-20260818123456x05b3c88`

#### Scenario: A hash beginning with zero produces a valid version

- **WHEN** the short commit hash consists only of digits and begins with `0`
- **THEN** the published version SHALL still be a valid semantic version

#### Scenario: The anticipated version is selected by package, not by position

- **WHEN** the pending release metadata describes more than one package
- **THEN** the nightly version SHALL use the entry naming the CLI package

#### Scenario: Nightlies sort chronologically

- **WHEN** two nightlies of the same `n.m.k` are compared
- **THEN** the one built later SHALL sort after the one built earlier

### Requirement: A nightly is installable by default

Every nightly version is a semantic-version prerelease, which a registry does not place on the default install tag on its own. Publishing SHALL therefore explicitly assign the default tag, so that installing the package without a version installs the most recent nightly.

#### Scenario: Installing without a version resolves the latest nightly

- **WHEN** `@taskless/cli-nightly` is installed with no version or tag specified
- **THEN** the most recently published nightly SHALL be installed

### Requirement: A nightly is published only from a commit that passed validation

A nightly SHALL be published only from a commit for which the repository's validation suite — build, lint, typecheck, and tests — has already reported success. A nightly asserts that the default branch works at that commit; a publish that races validation asserts only that the commit exists.

The decision SHALL be driven by validation's reported outcome rather than by the event that produced the commit, and SHALL distinguish three states: validation succeeded, validation did not succeed, and validation has not reported. The third SHALL NOT be treated as the first. A non-successful outcome SHALL leave visible evidence that the nightly was considered and declined, so that "declined" is distinguishable from "never triggered".

Success SHALL be tested for explicitly. An outcome SHALL NOT be accepted on the grounds that it is not a failure, because a validation run may end without either succeeding or failing.

The commit built and published SHALL be the commit validation reported on, and SHALL NOT be inferred from the state of the default branch at the time the decision is made, which may have advanced. When that commit cannot be identified, the run SHALL fail rather than fall back to any other commit.

Validation's outcome SHALL gate the publish regardless of why validation failed. No exemption is made for a failure the run's author judges cosmetic: nothing downstream can tell a repository-hygiene failure from a failing test suite, and a rule that publishes on some red states publishes on all of them.

#### Scenario: Failing validation publishes nothing

- **WHEN** validation does not succeed for a commit on the default branch
- **THEN** no nightly SHALL be published for that commit
- **AND** the declined publish SHALL be observable

#### Scenario: An inconclusive validation outcome is not a success

- **WHEN** validation ends without succeeding — cancelled, timed out, skipped, or otherwise inconclusive
- **THEN** no nightly SHALL be published

#### Scenario: The published commit is the validated commit

- **WHEN** further commits reach the default branch while validation of an earlier commit is still running
- **THEN** the nightly SHALL be built from the commit validation reported on, not from the newer tip

#### Scenario: An unidentifiable commit fails the run

- **WHEN** the commit validation reported on cannot be determined
- **THEN** the run SHALL fail
- **AND** no nightly SHALL be published

### Requirement: A nightly build is bounded by pending release metadata and by the commit

Two gates SHALL decide whether a nightly is built, evaluated in this order.

First, whether any release metadata is pending. When none is pending, nothing is unreleased, there is no proposed version to name, and no nightly SHALL be built. This gate SHALL be evaluated before any dependency installation, so the common case exits at the cheapest possible point.

Second, whether this commit already has a nightly. Published versions SHALL be queried and tested for one whose prerelease identifier ends with the short commit hash; if one exists, no nightly SHALL be built.

This second gate SHALL distinguish three outcomes: a nightly exists for the commit, no nightly exists for it, and the published versions could not be determined. The third SHALL fail the run rather than being treated as the second. Because each build stamps a fresh timestamp, treating an undeterminable answer as "none exists" publishes a second, differently-versioned nightly for the same commit and reports no error. A response indicating the package does not exist yet SHALL be treated as "no nightly exists", since it is the state before the first publish.

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

#### Scenario: An undeterminable published-version list fails the run

- **WHEN** the published versions cannot be determined, and the response does not indicate that the package is unpublished
- **THEN** the run SHALL fail
- **AND** no nightly SHALL be published

#### Scenario: An unpublished package is not a failure

- **WHEN** the nightly package has never been published
- **THEN** the gate SHALL treat the commit as having no nightly and the run SHALL continue

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
