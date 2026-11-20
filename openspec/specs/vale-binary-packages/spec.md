# vale-binary-packages Specification

## Purpose

The per-platform packages carrying the Vale binary: how they are built, how fetched binaries are verified against committed checksums, and why publishing one changes nothing for a consumer.

## Requirements

### Requirement: A Vale binary package is published per supported platform

The repository SHALL publish one npm package per supported platform, each carrying the Vale executable for that platform in its published tarball. Each package SHALL declare `os` and `cpu` matching the binary it carries, so that a consumer installs only the package matching its host.

#### Scenario: Only the host-matching package installs

- **WHEN** a consumer installs a package that declares every platform package as an optional dependency
- **THEN** only the package matching the host's `os` and `cpu` is installed, and the remainder are skipped without failing the install

#### Scenario: The binary is executable as published

- **WHEN** a published platform package is extracted
- **THEN** the Vale executable is present with its executable permission bit intact, requiring no permission change by the consumer

### Requirement: Platform packages contain no code and no install scripts

A platform package SHALL contain only the Vale executable and package metadata — `package.json`, a `README`, and the upstream `LICENSE`. It SHALL NOT declare a `bin` entry, SHALL NOT contain executable JavaScript, and SHALL NOT define any lifecycle script.

Consumers locate the binary by resolving the package and executing it by path, so nothing needs to be linked or copied into place at install time. Availability of the binary SHALL NOT depend on a consumer's package manager permitting dependency lifecycle scripts to run.

#### Scenario: No lifecycle script is required for the binary to be usable

- **WHEN** a consumer installs a platform package with dependency lifecycle scripts disabled
- **THEN** the Vale executable is present and usable, because no install-time step was needed to place it

#### Scenario: Package declares no bin entry

- **WHEN** a published platform package's `package.json` is inspected
- **THEN** it declares no `bin` entry and no `scripts` entry

### Requirement: Platform packages are versioned as timestamped prereleases

Every platform package SHALL be versioned `<valeVersion>-<yyyymmddhhmmss>`, where `<valeVersion>` is the upstream Vale release it carries and the prerelease identifier is the UTC release timestamp. A plain `<valeVersion>` SHALL NOT be published.

#### Scenario: Version names its upstream Vale release

- **WHEN** a platform package version is read
- **THEN** its `major.minor.patch` component is the upstream Vale version the package carries

#### Scenario: Republishing the same Vale version is always possible

- **WHEN** a packaging fix is needed for a Vale version that has already been published
- **THEN** a new package is published with the same `major.minor.patch` and a later timestamp, without requiring the Vale version component to change

#### Scenario: A caret range cannot resolve a platform package

- **WHEN** a consumer declares a dependency on a platform package using a caret or tilde range over the Vale version
- **THEN** no published version satisfies it, because every published version is a prerelease

#### Scenario: Timestamps order monotonically

- **WHEN** two platform package versions share a Vale version and differ by timestamp
- **THEN** the later timestamp is ordered as the greater version

### Requirement: Fetched binaries are verified against committed checksums

The repository SHALL commit a SHA256 checksum for each platform's upstream Vale release asset. The release pipeline SHALL verify every fetched binary against its committed checksum and SHALL refuse to publish on a mismatch.

Verification SHALL occur before any step holding publish credentials handles the binary, so that a credentialed step only ever processes bytes matching a reviewed digest.

#### Scenario: Checksum mismatch aborts the release

- **WHEN** a fetched binary's SHA256 does not match the committed checksum for that platform
- **THEN** the release fails and nothing is published

#### Scenario: Changing an expected binary requires review

- **WHEN** the Vale version or a platform's release asset changes
- **THEN** the corresponding committed checksum must change in the repository, passing through code review before any publish can succeed

### Requirement: Binaries are absent from version control

The repository SHALL NOT store Vale executables in version control. A platform package directory SHALL contain only its source-controlled metadata, and the executable SHALL be placed into the package by the release pipeline before packing.

#### Scenario: A clean checkout contains no binaries

- **WHEN** the repository is cloned
- **THEN** no Vale executable is present in any platform package directory, and the working tree is clean

### Requirement: Platform packages are released by their own workflow, tracking upstream

Platform packages SHALL be versioned and published by a workflow dedicated to them, independent of the workflow that releases packages managed by changesets. That workflow SHALL compare the latest upstream Vale release against what the repository has already published, and SHALL publish only when upstream is ahead.

A published-version check cannot bound these runs — every run stamps a previously unused timestamp — so the upstream comparison SHALL be what prevents redundant publishing.

That workflow SHALL publish without a human approval step, using the reviewer-free publishing environment. Its review gate is the manifest-update pull request, where a human reviews the upstream version and every checksum before anything may be published; an environment approval would be a second copy of a gate that already exists, at a point where nothing is being decided. The publish remains bounded by the branch policy on that environment and by the requirement below that a published platform package changes no consumer. Because removing the approval leaves the branch restriction as the only control over where a publish may run from, that restriction SHALL be enforced twice — once by the environment's configuration and once by the workflow itself, so that neither can be relaxed without the other noticing.

#### Scenario: Upstream unchanged publishes nothing

- **WHEN** the workflow runs and the latest upstream Vale release is already published as a platform package
- **THEN** no package is versioned or published

#### Scenario: A new upstream release opens a pull request rather than publishing

- **WHEN** the workflow runs and upstream Vale is ahead of what the repository has published
- **THEN** it opens a pull request updating the pinned Vale version and the committed checksums, and publishes nothing

#### Scenario: Merging the update publishes the set

- **WHEN** that pull request is merged
- **THEN** every supported platform package is stamped with the same version and published together, verified against the checksums that were just reviewed

#### Scenario: Publishing needs no approval click

- **WHEN** the publish phase runs after a merged manifest update
- **THEN** it SHALL proceed without waiting for an environment approval
- **AND** it SHALL run in the reviewer-free publishing environment, restricted to the default branch

#### Scenario: A publish requested from another branch does nothing

- **WHEN** a publish is requested manually from a ref other than the default branch
- **THEN** no package is published, and this SHALL hold independently of the publishing environment's configuration

#### Scenario: Ordinary pushes do not publish platform packages

- **WHEN** a commit is pushed to the default branch
- **THEN** the changeset-managed release flow publishes no platform package

### Requirement: Publishing a platform package changes no consumer

Publishing a platform package SHALL NOT alter the behavior of any already-published consumer. A consumer SHALL reach a newly published platform package only by a deliberate, reviewed change to the version it pins.

This is what allows the release workflow to run unattended.

#### Scenario: A new platform package is inert until pinned

- **WHEN** a platform package is published for a newer upstream Vale release
- **THEN** consumers continue to resolve the version they pin, and none resolves the new package until its pin is changed

### Requirement: Vale's grammars are published as one platform-independent package

The repository SHALL publish one npm package, `@taskless/vale-grammars`, carrying every tree-sitter grammar module that upstream publishes for the Vale release the platform packages carry. It SHALL declare no `os` or `cpu`, so every host installs the same bytes.

The package SHALL follow the platform packages' rules for contents and versioning: grammar modules and package metadata only, no `bin` entry, no executable JavaScript, no lifecycle script, and a version of `<valeVersion>-<yyyymmddhhmmss>` whose Vale component is the release the grammars came from.

#### Scenario: Every host installs the same grammars

- **WHEN** the grammar package is installed on two hosts with different operating systems or architectures
- **THEN** both hosts SHALL receive byte-identical grammar modules

#### Scenario: The grammar version names its Vale release

- **WHEN** a grammar package version is read
- **THEN** its `major.minor.patch` component SHALL be the upstream Vale release whose grammars it carries

#### Scenario: Grammars are usable without an install step

- **WHEN** the grammar package is installed with dependency lifecycle scripts disabled
- **THEN** the grammar modules SHALL be present and readable, and the package SHALL declare no `bin` and no `scripts` entry

### Requirement: Fetched grammars are verified against committed checksums

The repository SHALL commit a SHA256 checksum for each upstream grammar archive. Upstream's checksums file does not cover these archives, so the detect phase SHALL take each digest from the digest the upstream release records for that asset, SHALL refuse an asset that has none, and SHALL propose the digests in the same manifest pull request as the binary digests, where a human reviews them before anything can be published.

The release pipeline SHALL verify every fetched grammar archive against its committed checksum before unpacking it, SHALL refuse to publish on a mismatch, and SHALL refuse to publish when an archive the manifest names is missing upstream. Grammar modules SHALL NOT be stored in version control.

#### Scenario: Grammar checksum mismatch aborts the release

- **WHEN** a fetched grammar archive's SHA256 does not match its committed checksum
- **THEN** the release SHALL fail and no package, platform or grammar, SHALL be published

#### Scenario: A new upstream release proposes grammar digests for review

- **WHEN** the detect phase finds upstream Vale ahead of the manifest
- **THEN** the pull request it opens SHALL update every grammar digest alongside the binary digests, and SHALL publish nothing

#### Scenario: A clean checkout contains no grammar modules

- **WHEN** the repository is cloned
- **THEN** no grammar module SHALL be present in the grammar package directory

### Requirement: The grammar package is released with the platform packages

The workflow that releases the platform packages SHALL also release the grammar package, from the same reviewed manifest, stamped with the same version as the platform packages in the same run. A run SHALL be considered already published only when both the platform packages and the grammar package have a version for the pinned Vale release.

The CLI's dependencies on the grammar package and on the platform packages SHALL be moved together, by the same pull request, and SHALL all be the same exact stamped version. Publishing the grammar package SHALL change no consumer until that pin moves.

#### Scenario: Merging the update publishes binaries and grammars together

- **WHEN** a manifest update pull request is merged
- **THEN** every platform package and the grammar package SHALL be stamped with one version and published in the same run

#### Scenario: Missing grammars keep the gate open

- **WHEN** the platform packages are published for the pinned Vale release and the grammar package is not
- **THEN** the publish gate SHALL NOT report the release as already published

#### Scenario: The pins never straddle two Vale releases

- **WHEN** the pull request that moves the CLI's Vale pins is opened
- **THEN** it SHALL move the grammar package pin with the platform pins, all to one exact stamped version
