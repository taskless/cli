## MODIFIED Requirements

### Requirement: A published nightly is announced on the pending release pull request

When a nightly is published, the open pull request that carries the pending release metadata SHALL be annotated with a delimited build-info region naming the published package, the version, the commit it was built from, and the time it was built — so the reviewers of that pull request can install and exercise the work it describes.

Every fact in that region SHALL be derived from the version the publish stamped, not determined independently. The version already encodes the build time and the commit, and a second determination reads a second clock.

Each publish SHALL place the region at the top of the body's description, SHALL replace any region a previous publish left rather than adding to it, and SHALL be restored if a human deletes it. When the body opens with a stack-breadcrumb region, the build-info region SHALL be placed directly below that region rather than above it, which is where the stack-breadcrumb writer's own layout leaves it. It SHALL NOT modify any other managed region on that body.

Placement is asserted of the write, not of the body for all time: other writers maintain their own regions on the same body and may re-lay it. A publish SHALL return the region to the top of the description rather than leave it where it was found. A publish SHALL NOT overwrite a region naming a build newer than its own.

The annotation SHALL depend on the publish having succeeded, and SHALL be performed by a job that holds permission to write pull requests and holds no publishing credential — the ability to publish under the organization's scope and the ability to rewrite pull request text SHALL NOT be held by one job.

#### Scenario: A publish annotates the open release pull request

- **WHEN** a nightly is published and a pull request carrying the pending release metadata is open
- **THEN** that pull request's description SHALL begin with a build-info region naming the published package, version, commit, and build time

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

- **WHEN** a push publishes no nightly
- **THEN** no job holding permission to write pull requests SHALL be instantiated for it
