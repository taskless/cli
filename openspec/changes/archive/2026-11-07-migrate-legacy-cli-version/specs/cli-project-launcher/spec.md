## MODIFIED Requirements

### Requirement: A launcher runs the version recorded for its package

When run, a launcher SHALL read `.taskless/taskless.json` from the `.taskless/` directory that contains it, not from the working directory, and take its package's version from `install.launchers`. `install.launchers` SHALL be the only source: a package it does not name has no recorded version, and the launcher SHALL NOT read `install.cliVersion`. A manifest written before `install.launchers` existed is moved into it by scaffold migration 13, which the `init` that writes the launcher runs first. It SHALL then run that version's installed entry point from `.taskless/.cache/<package>@<version>/`, installing it there first from the package's lockfile when it is absent, with the Node executable that is running the launcher and every argument it was given, unchanged and in order, inheriting standard input, output, and error, and the working directory and environment it was started with. It SHALL NOT run the CLI through `npx`.

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

- **WHEN** `install.launchers` is absent, `install.cliVersion` is `0.13.0`, and `init` runs
- **THEN** scaffold migration 13 SHALL record `install.launchers["@taskless/cli"]` as `0.13.0` before the launcher is written
- **AND** `./.taskless/bin/cli.mjs` SHALL run `@taskless/cli@0.13.0`
- **AND** `./.taskless/bin/cli-nightly.mjs` SHALL NOT run `0.13.0`

#### Scenario: A self install's version belongs to no launcher

- **WHEN** `install.launchers` is absent and `install.cliVersion` is `0.13.0-self`
- **THEN** neither `./.taskless/bin/cli.mjs` nor `./.taskless/bin/cli-nightly.mjs` SHALL run `0.13.0-self`

#### Scenario: cliVersion alone records no version

- **WHEN** `install.launchers` is absent and `install.cliVersion` is `0.13.0`, as only a manifest edited by hand after migration 13 can be
- **THEN** neither `./.taskless/bin/cli.mjs` nor `./.taskless/bin/cli-nightly.mjs` SHALL run `0.13.0`
- **AND** each SHALL fail as a launcher without a version

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

### Requirement: A launcher without a version fails plainly

When no version for its package can be read, because `.taskless/taskless.json` is missing or does not parse, or `install.launchers` holds no version for its package, the launcher SHALL install nothing, run nothing, print one message to standard error naming the file it read and the installer command that records a version, and exit with a non-zero status.

#### Scenario: No version recorded

- **WHEN** `install.launchers` holds no release version and `./.taskless/bin/cli.mjs check` runs
- **THEN** no `npm` or `npx` process SHALL start
- **AND** standard error SHALL name `.taskless/taskless.json` and the installer command
- **AND** the exit status SHALL be non-zero
