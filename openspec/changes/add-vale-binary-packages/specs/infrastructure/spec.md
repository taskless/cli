## ADDED Requirements

### Requirement: Script-versioned packages are excluded from changesets

Workspace packages whose versions are assigned by a release workflow SHALL be listed in the changesets `ignore` configuration, so that changesets neither versions nor publishes them and no changeset is required for them.

#### Scenario: Changesets does not version the platform packages

- **WHEN** `changeset version` runs
- **THEN** the workflow-versioned platform packages are left at their current versions

#### Scenario: Changesets does not publish the platform packages

- **WHEN** the release flow publishes on the default branch
- **THEN** it publishes only the packages changesets manages, and the platform packages are untouched

#### Scenario: A platform-package change needs no changeset

- **WHEN** a pull request modifies only workflow-versioned platform packages
- **THEN** the changeset requirement check does not fail for the absence of a changeset
