# cli-project-launcher Specification

## Purpose

A project-local launcher that runs the Taskless CLI version the project recorded, so agents, git hooks, and CI in any language call one fixed command that an agent harness can allow by path.

## Requirements

### Requirement: Each package has its own launcher

The release package SHALL install its launcher at `.taskless/bin/cli.mjs`, and the nightly package at `.taskless/bin/cli-nightly.mjs`. A build SHALL write and rewrite only its own package's launcher. A nightly build SHALL NEVER read, edit, or remove the release's launcher, so a nightly installs beside the release. A release build SHALL NOT read or edit the nightly's launcher, and SHALL remove it when it installs, because installing the release is the move back to mainline. A build whose invocation names neither package, such as a `self` build, SHALL write no launcher and remove none.

Each launcher SHALL be an ES module (`.mjs`) whose first line is `#!/usr/bin/env node`, and SHALL be written with its executable bits set where the filesystem supports them. Its content SHALL be identical for every version of its package, so an upgrade never changes its bytes unless the launcher itself changed.

#### Scenario: The release installs cli.mjs

- **WHEN** `init` runs from the release package
- **THEN** `.taskless/bin/cli.mjs` SHALL exist, begin with `#!/usr/bin/env node`, and be executable
- **AND** `.taskless/bin/cli-nightly.mjs` SHALL NOT be created

#### Scenario: A nightly leaves the release's launcher alone

- **WHEN** `.taskless/bin/cli.mjs` exists and `init` runs from a nightly
- **THEN** `.taskless/bin/cli.mjs` SHALL be byte-identical afterwards
- **AND** `.taskless/bin/cli-nightly.mjs` SHALL exist

#### Scenario: The release removes the nightly's launcher

- **WHEN** `.taskless/bin/cli-nightly.mjs` exists and `init` runs from the release
- **THEN** `.taskless/bin/cli-nightly.mjs` SHALL NOT exist afterwards
- **AND** `.taskless/bin/cli.mjs` SHALL exist

#### Scenario: An upgrade does not rewrite an unchanged launcher

- **WHEN** `init` runs at `0.13.1` over a project installed at `0.13.0`, and the launcher template did not change between them
- **THEN** the launcher's bytes SHALL be unchanged

### Requirement: A launcher runs the version recorded for its package

When run, a launcher SHALL read `.taskless/taskless.json` from the `.taskless/` directory that contains it, not from the working directory, and take its package's version from `install.launchers`. When that field has no version for its package, it SHALL fall back to `install.cliVersion`, but only when that version belongs to its package: a version containing `-` belongs to the nightly, and one without belongs to the release. It SHALL then run that version's installed entry point from `.taskless/.cache/<package>@<version>/`, installing it there first from the package's lockfile when it is absent, with the Node executable that is running the launcher and every argument it was given, unchanged and in order, inheriting standard input, output, and error, and the working directory and environment it was started with. It SHALL NOT run the CLI through `npx`.

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

#### Scenario: Run from a subdirectory

- **WHEN** the working directory is `src/` and `../.taskless/bin/cli.mjs check` runs
- **THEN** the launcher SHALL read the version from, and use the cache in, the `.taskless/` that contains it
- **AND** the CLI SHALL start in `src/`

#### Scenario: The exit status passes through

- **WHEN** the CLI exits with status 1 because a rule failed
- **THEN** the launcher SHALL exit with status 1

### Requirement: A launcher without a version fails plainly

When no version for its package can be read, because `.taskless/taskless.json` is missing or does not parse, or neither field holds a version for its package, the launcher SHALL install nothing, run nothing, print one message to standard error naming the file it read and the installer command that records a version, and exit with a non-zero status.

#### Scenario: No version recorded

- **WHEN** `install.launchers` and `install.cliVersion` hold no release version and `./.taskless/bin/cli.mjs check` runs
- **THEN** no `npm` or `npx` process SHALL start
- **AND** standard error SHALL name `.taskless/taskless.json` and the installer command
- **AND** the exit status SHALL be non-zero

### Requirement: A launcher describes itself plainly

A launcher's comments SHALL state only what it does: that it runs the Taskless CLI version recorded in `.taskless/taskless.json` for its package. They SHALL NOT describe the launcher as a way around a permission prompt, a safety classifier, or a review, since an agent that reads such a comment can be refused for it.

#### Scenario: The comments say what it does

- **WHEN** a launcher's source is read
- **THEN** its comments SHALL name `.taskless/taskless.json` and the package it runs
- **AND** SHALL NOT contain the words "bypass", "classifier", or "auto mode"

### Requirement: Messages a person reads name the launcher that started the CLI

When a project launcher started the CLI, as its environment variable reports with exactly one of the two launcher paths, every command the CLI prints for a person to run next (a remedy in an error, a hint after a command, the installer named in a `SKIPPED (global):` line) SHALL name that launcher's path. Otherwise it SHALL name the detected `npx` or `pnpm dlx` invocation, as before. A remedy that names the CLI SHALL reach it through this one choice rather than spelling the build's invocation itself.

#### Scenario: A hint after a launcher run

- **WHEN** `./.taskless/bin/cli.mjs check` runs in a project with no rules
- **THEN** the hint SHALL tell the reader to run `./.taskless/bin/cli.mjs rule create --from <file>`

#### Scenario: A hint after an npx run

- **WHEN** `npx @taskless/cli@0.13.0 check` runs in a project with no rules and no launcher variable set
- **THEN** the hint SHALL name `npx @taskless/cli@0.13.0`

#### Scenario: An unexpected variable is ignored

- **WHEN** the launcher variable is `./evil.sh`
- **THEN** printed commands SHALL NOT name `./evil.sh`

### Requirement: Each published build carries the lockfile of its tested dependencies

A nightly or release build SHALL carry an npm lockfile for its own package, derived from the repository's `pnpm-lock.yaml` without network access, that pins every package in the CLI's production dependency tree, including every platform's optional packages, to the version and integrity `pnpm-lock.yaml` records, with each package's platform constraints. The CLI's `package.json` SHALL NOT be changed to produce it. When the tree cannot be expressed as one flat lockfile, or a package in it has no recorded integrity, the build SHALL fail. A `self` build SHALL carry no lockfile.

#### Scenario: The lockfile matches what CI tested

- **WHEN** `pnpm-lock.yaml` resolves the CLI's `tsx` to `4.21.0` and its `esbuild` to `0.27.3`, and a release build runs
- **THEN** the build's lockfile SHALL pin `tsx` at `4.21.0` and `esbuild` at `0.27.3`, each with the integrity `pnpm-lock.yaml` records
- **AND** the CLI's `package.json` SHALL still declare its ranges

#### Scenario: Two versions of one dependency

- **WHEN** the CLI's production tree in `pnpm-lock.yaml` holds the same package at two versions
- **THEN** the nightly and release builds SHALL fail and name that package

### Requirement: A launcher installs from its lockfile once, completely

When `.taskless/.cache/<package>@<version>/` does not exist, the launcher SHALL install `<package>@<version>` with `npm ci` from the lockfile beside it (`.taskless/bin/cli.lock.json` for the release, `.taskless/bin/cli-nightly.lock.json` for the nightly), without running any package's install scripts, into a new temporary directory under `.taskless/.cache/`. It SHALL make that the final directory only after npm succeeded and the package's entry point resolves. An existing final directory SHALL be treated as a complete install. When another process created the final directory first, the launcher SHALL discard its own install and run the existing one.

The launcher SHALL NOT install without its lockfile, and SHALL NOT install when the lockfile does not name the recorded version; in both cases it SHALL print one message to standard error naming the lockfile and the installer command that rewrites it, and exit with a non-zero status.

The install SHALL use the nearest `.npmrc` at or above the project root, short of the user's home directory (whose `.npmrc` npm already reads as user configuration), when one exists, so a registry configured there applies, and that file SHALL NOT remain in the cache afterwards. npm's output SHALL go to standard error, never standard output.

#### Scenario: First run installs the tested tree, later runs do not install

- **WHEN** `.taskless/.cache/` holds nothing for `@taskless/cli@0.13.0`, `.taskless/bin/cli.lock.json` pins `tsx` at `4.21.0`, and `./.taskless/bin/cli.mjs --version` runs twice
- **THEN** the first run SHALL install into `.taskless/.cache/@taskless/cli@0.13.0/` with `tsx` at `4.21.0` and only the current platform's binaries, and print `0.13.0`
- **AND** the second run SHALL start no `npm` process

#### Scenario: Missing lockfile

- **WHEN** `install.launchers` records `@taskless/cli` at `0.13.0` and `.taskless/bin/cli.lock.json` does not exist
- **THEN** no `npm` process SHALL start
- **AND** standard error SHALL name `.taskless/bin/cli.lock.json` and the installer command
- **AND** the exit status SHALL be non-zero

#### Scenario: Lockfile for another version

- **WHEN** `install.launchers` records `@taskless/cli` at `0.13.1` and `.taskless/bin/cli.lock.json` pins `@taskless/cli` at `0.13.0`
- **THEN** the launcher SHALL NOT install or run anything, and SHALL exit non-zero naming the lockfile

#### Scenario: A registry configured above a monorepo package is used

- **WHEN** `.taskless/` is in `packages/app/` and the repository root has an `.npmrc` setting `registry=`
- **THEN** the launcher's install SHALL use that `.npmrc`

#### Scenario: A project registry is used

- **WHEN** the project root has an `.npmrc` setting `registry=` and the launcher installs
- **THEN** npm SHALL fetch from that registry
- **AND** the cache entry SHALL NOT contain an `.npmrc` afterwards

#### Scenario: JSON output stays clean on a first run

- **WHEN** the first run of a version is `./.taskless/bin/cli.mjs info --json`
- **THEN** standard output SHALL hold only the CLI's JSON

#### Scenario: Two first runs at once

- **WHEN** two launcher processes start with no cache entry for the recorded version
- **THEN** both SHALL run the CLI
- **AND** exactly one cache entry for that version SHALL remain, with no temporary directory left by either

### Requirement: A failed install runs nothing

When npm cannot be started, or the install fails, or the installed package's entry point does not resolve, the launcher SHALL remove its temporary directory, leave no final directory, print a message to standard error naming the package and version it tried to install, and exit with a non-zero status without running the CLI.

#### Scenario: npm is not on PATH

- **WHEN** no `npm` executable can be found and the recorded version is not installed
- **THEN** standard error SHALL say npm is needed to install `@taskless/cli@0.13.0`
- **AND** the exit status SHALL be non-zero
- **AND** `.taskless/.cache/` SHALL hold no entry for that version

#### Scenario: The registry refuses

- **WHEN** npm exits non-zero
- **THEN** npm's error SHALL appear on standard error
- **AND** the CLI SHALL NOT run

### Requirement: The launcher cache ignores itself

Whenever the launcher creates `.taskless/.cache/`, or finds it without one, it SHALL write `.taskless/.cache/.gitignore` containing `*`, so nothing in the cache is committed without any change to the project's other ignore files.

#### Scenario: A fresh cache is not tracked

- **WHEN** the launcher installs into a project with no `.taskless/.cache/`
- **THEN** `git status` SHALL show nothing under `.taskless/.cache/`

### Requirement: The launcher drops versions nothing records

After the launcher installs a new version, it SHALL remove every `.taskless/.cache/` entry that is not the version recorded for either package, including the fallback it would use, and every temporary install directory more than an hour old. Removal SHALL be best effort: an entry that cannot be removed SHALL be left, and SHALL NOT change the launcher's exit status or output.

#### Scenario: An upgrade pulled from git

- **WHEN** `.taskless/.cache/` holds `@taskless/cli@0.13.0`, `install.launchers` now records `@taskless/cli` at `0.13.1`, and the launcher runs
- **THEN** it SHALL install `0.13.1` and run it
- **AND** `@taskless/cli@0.13.0` SHALL no longer be in the cache

#### Scenario: The other package's version is kept

- **WHEN** `install.launchers` records both packages and the release launcher installs a new release
- **THEN** the cache entry for the recorded nightly version SHALL remain
