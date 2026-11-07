## MODIFIED Requirements

### Requirement: A launcher runs the version recorded for its package

When run, a launcher SHALL read `.taskless/taskless.json` from the `.taskless/` directory that contains it, not from the working directory, and take its package's version from `install.launchers`. Once `install.launchers` records a version for any package, it SHALL be the only source, and a package it does not name has no recorded version. Only a manifest whose `install.launchers` records no version, one written before that field existed, SHALL fall back to `install.cliVersion`, and only when that version belongs to the launcher's package: a version with no prerelease part belongs to the release, a version ending in `-self` (a development build run from a path) belongs to no package, and any other prerelease belongs to the nightly. It SHALL then run that version's installed entry point from `.taskless/.cache/<package>@<version>/`, installing it there first from the package's lockfile when it is absent, with the Node executable that is running the launcher and every argument it was given, unchanged and in order, inheriting standard input, output, and error, and the working directory and environment it was started with. It SHALL NOT run the CLI through `npx`.

The launcher SHALL add one variable to the environment it passes on, naming its own path relative to the project root, so the CLI it starts can name the launcher in what it prints.

It SHALL exit with the CLI's exit status. When the CLI is ended by a signal, the launcher SHALL exit as that signal would end it. When the recorded version is already installed, it SHALL make no network request and start no package manager. It SHALL NEVER fall back to an unpinned or dist-tagged version.

#### Scenario: The release launcher runs its pin

- **WHEN** `install.launchers` records `@taskless/cli` at `0.13.0`, `.taskless/.cache/@taskless/cli@0.13.0/` holds that version, and `./.taskless/bin/cli.mjs check src/a.ts` runs
- **THEN** it SHALL run that directory's `@taskless/cli` entry point with `check src/a.ts`
- **AND** no `npm` or `npx` process SHALL start

#### Scenario: A nightly install does not move the release launcher

- **WHEN** `install.launchers` records `@taskless/cli` at `0.13.0`, and a nightly `init` sets `install.cliVersion` to `0.14.0-20261020120000xabc1234`
- **THEN** `./.taskless/bin/cli.mjs` SHALL still run `@taskless/cli@0.13.0`

#### Scenario: A manifest from an older CLI still works

- **WHEN** `install.launchers` is absent and `install.cliVersion` is `0.13.0`
- **THEN** `./.taskless/bin/cli.mjs` SHALL run `@taskless/cli@0.13.0`
- **AND** `./.taskless/bin/cli-nightly.mjs` SHALL NOT run `0.13.0`

#### Scenario: A self install's version belongs to no launcher

- **WHEN** `install.launchers` is absent and `install.cliVersion` is `0.13.0-self`
- **THEN** neither `./.taskless/bin/cli.mjs` nor `./.taskless/bin/cli-nightly.mjs` SHALL run `0.13.0-self`

#### Scenario: A recorded launcher map is the only source

- **WHEN** `install.launchers` records only `@taskless/cli` at `0.13.0`, and `install.cliVersion` is `0.14.0-20261020120000xabc1234`
- **THEN** `./.taskless/bin/cli-nightly.mjs` SHALL find no recorded version
- **AND** SHALL NOT run `0.14.0-20261020120000xabc1234`

#### Scenario: Run from a subdirectory

- **WHEN** the working directory is `src/` and `../.taskless/bin/cli.mjs check` runs
- **THEN** the launcher SHALL read the version from, and use the cache in, the `.taskless/` that contains it
- **AND** the CLI SHALL start in `src/`

#### Scenario: The exit status passes through

- **WHEN** the CLI exits with status 1 because a rule failed
- **THEN** the launcher SHALL exit with status 1
