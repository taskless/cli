## MODIFIED Requirements

### Requirement: The CLI has three build targets

The CLI SHALL support exactly three build targets, selected by `TASKLESS_BUILD_TARGET`: `prod` (the default, emitting `dist/` with the published invocation pinned to the build's own version, `npx @taskless/cli@<version>`), `self` (emitting `dist-self/` with a repo-root-relative path, for dogfooding inside this repository), and `nightly` (emitting `dist/` with `npx @taskless/cli-nightly@<version>`).

There SHALL NOT be a build target that emits an invocation runnable from outside this repository's checkout. Exercising unreleased behavior elsewhere is served by a published nightly, which resolves on any machine and is pinned to the build whose instructions it carries, rather than by an absolute filesystem path baked into shipped content.

An unset or unrecognized `TASKLESS_BUILD_TARGET` SHALL resolve to `prod`. The retired value `dev` SHALL be an exception: it SHALL fail the build with an error naming the target as removed, because a caller who sets it is looking for an output directory that will not be written, and a silent fall back to `prod` would surface only as a missing file at a path nothing else mentions.

#### Scenario: The prod target pins its version

- **WHEN** a build runs with `TASKLESS_BUILD_TARGET` unset
- **THEN** the baked invocation SHALL be `npx @taskless/cli@<version>`, where `<version>` is the version the build reports
- **AND** whether a build is the released one SHALL be read from its build target, not by comparing its invocation to an unpinned string

#### Scenario: The self target stays repo-relative

- **WHEN** a build runs with `TASKLESS_BUILD_TARGET=self`
- **THEN** the output SHALL be written to `dist-self/`
- **AND** the baked invocation SHALL be a path relative to the repo root

#### Scenario: A retired target fails loudly

- **WHEN** a build runs with `TASKLESS_BUILD_TARGET=dev`
- **THEN** the build SHALL fail with an error stating the target has been removed
- **AND** SHALL NOT fall back to the `prod` target

#### Scenario: An unknown target still defaults to prod

- **WHEN** a build runs with `TASKLESS_BUILD_TARGET` unset or set to an unrecognized value other than `dev`
- **THEN** the build SHALL resolve to the `prod` target
