## ADDED Requirements

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

The repository SHALL commit a SHA256 checksum for each upstream grammar archive. Upstream's checksums file does not cover these archives, so the detect phase SHALL compute each digest from the archive it downloads and SHALL propose it in the same manifest pull request as the binary digests, where a human reviews it before anything can be published.

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

The CLI's dependencies on the grammar package and on the platform packages SHALL be moved together, by the same pull request, and SHALL name the same Vale release. Publishing the grammar package SHALL change no consumer until that pin moves.

#### Scenario: Merging the update publishes binaries and grammars together

- **WHEN** a manifest update pull request is merged
- **THEN** every platform package and the grammar package SHALL be stamped with one version and published in the same run

#### Scenario: Missing grammars keep the gate open

- **WHEN** the platform packages are published for the pinned Vale release and the grammar package is not
- **THEN** the publish gate SHALL NOT report the release as already published

#### Scenario: The pins never straddle two Vale releases

- **WHEN** the pull request that moves the CLI's Vale pins is opened
- **THEN** it SHALL move the grammar package pin with the platform pins, and both SHALL name the same Vale release
