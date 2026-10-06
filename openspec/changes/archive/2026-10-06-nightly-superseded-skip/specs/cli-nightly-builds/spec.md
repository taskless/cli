## ADDED Requirements

### Requirement: A superseded nightly is not published

Every publish assigns the default install tag, so a publish that lands after a newer commit's nightly would move installers back to older code. Immediately before publishing, the run SHALL query the published versions and SHALL NOT publish when any published nightly's timestamp is later than its own; the newer nightly already contains its commit. Such a run SHALL succeed, and SHALL report that it was superseded.

The check SHALL be made at the moment of publishing and not only when the run decides to build, because a run can be held between the two, and a newer commit landing during that hold is the case the check exists for.

Timestamps SHALL be compared alone, not whole versions. The anticipated `n.m.k` can decrease between commits when pending release metadata is removed, and a whole-version comparison would rank the newer commit's nightly below an older one. An equal timestamp SHALL NOT count as later.

The check SHALL distinguish three outcomes: a later nightly exists, none exists, and the published versions could not be determined. The third SHALL fail the run rather than be treated as the second, since treating it as "none exists" publishes over a newer nightly and reports no error.

The check SHALL NOT be implemented by cancelling runs: a mechanism that cancels a superseded run can also cancel a publish already in progress.

#### Scenario: A run held past a newer commit's publish publishes nothing

- **WHEN** a run for an older commit reaches publishing after a newer commit's nightly was published
- **THEN** no nightly SHALL be published for the older commit
- **AND** the default install tag SHALL still name the newer commit's nightly
- **AND** the run SHALL succeed

#### Scenario: A newer nightly with a lower anticipated version still supersedes

- **WHEN** the published nightly with the later timestamp anticipates a lower `n.m.k` than the run's own version
- **THEN** the run SHALL NOT publish

#### Scenario: Nothing newer publishes normally

- **WHEN** no published nightly has a later timestamp than the run's own version
- **THEN** the nightly SHALL be published

#### Scenario: An undeterminable list fails the superseded check

- **WHEN** the published versions cannot be determined at the moment of publishing
- **THEN** the run SHALL fail
- **AND** no nightly SHALL be published

## MODIFIED Requirements

### Requirement: A nightly version names the release it anticipates, the time, and the commit

A nightly version SHALL take the form `<n.m.k>-<yyyymmddhhmmss>x<sha>`, where `n.m.k` is the version the default branch's pending release metadata proposes, `yyyymmddhhmmss` is the commit's committer date in UTC, and `sha` is the short commit hash.

The timestamp SHALL be the commit's date and SHALL NOT be read from the clock of the run that builds it. A run can be held between deciding to publish and publishing, and a clock read after the hold would stamp an older commit newer than one that landed during it. The default branch is merged by rebase only, so a commit's committer date is when it landed, and stamps follow the order of the default branch.

The pending release metadata describes every package it releases, so `n.m.k` SHALL be selected by matching the CLI package's name, and SHALL NOT be taken by position. Position is correct only while the CLI is the sole package under release management, and a version taken from another package publishes successfully while naming a release that was never proposed.

The timestamp SHALL precede the commit hash, so that lexical comparison of the prerelease identifier orders builds by when their commits landed. The prerelease identifier SHALL contain a non-digit separator between the timestamp and the hash, so that the identifier is never all-digits — an all-digit prerelease identifier is compared numerically and may not begin with a zero, which a hash beginning with `0` would otherwise violate.

#### Scenario: A nightly version is stamped

- **WHEN** pending release metadata proposes `0.11.0`, the commit's committer date is `2026-08-18T12:34:56Z`, and the short commit hash is `05b3c88`
- **THEN** the published version SHALL be `0.11.0-20260818123456x05b3c88`

#### Scenario: A hash beginning with zero produces a valid version

- **WHEN** the short commit hash consists only of digits and begins with `0`
- **THEN** the published version SHALL still be a valid semantic version

#### Scenario: The anticipated version is selected by package, not by position

- **WHEN** the pending release metadata describes more than one package
- **THEN** the nightly version SHALL use the entry naming the CLI package

#### Scenario: Nightlies sort chronologically

- **WHEN** two nightlies of the same `n.m.k` are compared
- **THEN** the one whose commit landed later SHALL sort after the one whose commit landed earlier

#### Scenario: A delayed build keeps its commit's time

- **WHEN** a run for a commit is held for some time before it builds
- **THEN** its version SHALL carry the commit's date, not the time the build ran

#### Scenario: An offset commit date is stamped in UTC

- **WHEN** the commit's committer date is `2026-10-06T11:23:45-07:00`
- **THEN** the version's timestamp SHALL be `20261006182345`

### Requirement: A nightly build is bounded by pending release metadata and by the commit

Two gates SHALL decide whether a nightly is built, evaluated in this order.

First, whether any release metadata is pending. When none is pending, nothing is unreleased, there is no proposed version to name, and no nightly SHALL be built. This gate SHALL be evaluated before any dependency installation, so the common case exits at the cheapest possible point.

Second, whether this commit already has a nightly. Published versions SHALL be queried and tested for one whose prerelease identifier ends with the short commit hash; if one exists, no nightly SHALL be built.

This second gate SHALL distinguish three outcomes: a nightly exists for the commit, no nightly exists for it, and the published versions could not be determined. The third SHALL fail the run rather than being treated as the second: a gate whose only purpose is suppression SHALL NOT fail open. A response indicating the package does not exist yet SHALL be treated as "no nightly exists", since it is the state before the first publish.

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

### Requirement: A published nightly is announced on the pending release pull request

When a nightly is published, the open pull request that carries the pending release metadata SHALL be annotated with a delimited build-info region naming the published package, the version, the commit it was built from, and the time that commit landed — so the reviewers of that pull request can install and exercise the work it describes.

Every fact in that region SHALL be derived from the version the publish stamped, not determined independently. The version already encodes the commit's time and the commit, and a second determination could disagree with it.

Each publish SHALL place the region at the top of the body's description, SHALL replace any region a previous publish left rather than adding to it, and SHALL be restored if a human deletes it. When the body opens with a stack-breadcrumb region, the build-info region SHALL be placed directly below that region rather than above it, which is where the stack-breadcrumb writer's own layout leaves it. It SHALL NOT modify any other managed region on that body.

Placement is asserted of the write, not of the body for all time: other writers maintain their own regions on the same body and may re-lay it. A publish SHALL return the region to the top of the description rather than leave it where it was found. A publish SHALL NOT overwrite a region naming a build newer than its own.

The annotation SHALL depend on the publish having succeeded and having published, so a run skipped as superseded announces nothing, and SHALL be performed by a job that holds permission to write pull requests and holds no publishing credential — the ability to publish under the organization's scope and the ability to rewrite pull request text SHALL NOT be held by one job.

#### Scenario: A publish annotates the open release pull request

- **WHEN** a nightly is published and a pull request carrying the pending release metadata is open
- **THEN** that pull request's description SHALL begin with a build-info region naming the published package, version, commit, and commit time

#### Scenario: A stack breadcrumb stays first

- **WHEN** the body opens with a stack-breadcrumb region
- **THEN** the build-info region SHALL be placed directly below it, and the stack-breadcrumb region SHALL be left unchanged

#### Scenario: Repeated publishes replace the region

- **WHEN** a second nightly is published while the same pull request is open
- **THEN** the pull request SHALL carry exactly one build-info region, describing the most recent publish

#### Scenario: Another writer moves the region

- **WHEN** another writer re-lays the body and the region no longer sits at the top of the description
- **THEN** the next publish SHALL move it back to the top rather than leave it in place or write a second one

#### Scenario: An older build does not overwrite a newer one

- **WHEN** the region on the pull request names a build newer than the one being announced
- **THEN** the body SHALL be left unchanged

#### Scenario: No open release pull request is not a failure

- **WHEN** a nightly is published and no pull request carrying pending release metadata is open
- **THEN** the run SHALL succeed and annotate nothing

#### Scenario: An unanswered query is a failure

- **WHEN** the query for the pull request fails
- **THEN** the run SHALL fail rather than treat the failure as "no pull request is open"

#### Scenario: A suppressed nightly annotates nothing

- **WHEN** a push publishes no nightly, including a run skipped because a newer nightly was already published
- **THEN** no job holding permission to write pull requests SHALL be instantiated for it
