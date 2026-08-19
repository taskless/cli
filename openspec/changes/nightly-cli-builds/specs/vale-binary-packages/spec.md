## MODIFIED Requirements

### Requirement: Platform packages are released by their own workflow, tracking upstream

Platform packages SHALL be versioned and published by a workflow dedicated to them, independent of the workflow that releases packages managed by changesets. That workflow SHALL compare the latest upstream Vale release against what the repository has already published, and SHALL publish only when upstream is ahead.

A published-version check cannot bound these runs — every run stamps a previously unused timestamp — so the upstream comparison SHALL be what prevents redundant publishing.

That workflow SHALL publish without a human approval step, using the reviewer-free publishing environment. Its review gate is the manifest-update pull request, where a human reviews the upstream version and every checksum before anything may be published; an environment approval would be a second copy of a gate that already exists, at a point where nothing is being decided. The publish remains bounded by the branch policy on that environment and by the requirement below that a published platform package changes no consumer.

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

#### Scenario: Ordinary pushes do not publish platform packages

- **WHEN** a commit is pushed to the default branch
- **THEN** the changeset-managed release flow publishes no platform package
