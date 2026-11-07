## MODIFIED Requirements

### Requirement: Init raises Taskless CLI pins

After a successful install, `taskless init` SHALL read `package.json` in the working directory, the `package.json` of every workspace package the working directory declares, and the project's CI and git-hook configuration files, and report every entry naming `@taskless/cli` or `@taskless/cli-nightly` that this requirement raises, each with a `reason`.

Workspace packages are declared by the `packages` list of `pnpm-workspace.yaml` and by the `workspaces` field of the root `package.json`, as an array or as `{ packages }`; both sources SHALL be read. A pattern SHALL name each directory it matches that holds a `package.json`. A pattern prefixed `!` SHALL remove the directories it matches. A pattern that is absolute or contains a `..` segment SHALL be skipped. Expansion SHALL NOT descend into `node_modules` or `.git`, and SHALL stop after a fixed number of manifests. The root SHALL be read once even when a pattern names it. An absent or malformed workspace declaration SHALL declare nothing, and a malformed root `package.json` SHALL NOT stop `pnpm-workspace.yaml` from being read.

The CI and hook files read SHALL be the ones `detect` recognizes as CI and commit-time configuration at the project root: `.github/workflows/*.yml` and `*.yaml`, `.gitlab-ci.yml`, `.circleci/config.yml`, `Jenkinsfile`, `azure-pipelines.yml` and `.yaml`, `bitbucket-pipelines.yml`, `.drone.yml`, `.travis.yml`, the files directly in `.buildkite/` and `.husky/`, the lefthook, pre-commit, simple-git-hooks, and lint-staged config files.

An entry is:

- a dependency: an entry in `dependencies`, `devDependencies`, or `optionalDependencies`; or
- a command pin: a `package.json` script, or a line of a CI or hook file, that spells out `@taskless/cli@<spec>` or `@taskless/cli-nightly@<spec>`, where the name is not the tail of a longer name and the spec ends at whitespace, a quote, or shell punctuation (`;&|()<>,:`). A pin repeated within one script SHALL be reported once, and a pin repeated within one CI or hook file once, at its first line.

Every dependency SHALL be reported with reason `dependency`, whatever its spec, its package, or the running channel, because the CLI runs through the project launcher and a dependency stays on the build its lockfile resolved. Its `installed` SHALL be the version read from `node_modules/<name>/package.json` in the directory holding it, then in each parent up to the working directory, the first found winning, as Node resolves it; `null` when none is found.

A command pin SHALL be judged by the running channel first. The running channel SHALL be taken from the build target, not read from the version: a release, a nightly, or a development (`self`) build run from a path, whose version carries a `-self` prerelease and which publishes no package.

- Under a nightly, a `@taskless/cli` command pin SHALL NOT be reported, because a nightly installs beside the release, except that when the same run migrated an existing `.taskless/` (the migration's `from` is above `0`) it SHALL be reported with reason `unreleased`.
- Under a release, a `@taskless/cli-nightly` command pin SHALL be reported with reason `nightly`, whatever its version, because a release install is the move back to mainline.
- Under a self build, no command pin SHALL be reported, because there is no published version to move it to, except that a `@taskless/cli` pin SHALL be reported with reason `unreleased` when the same run migrated an existing `.taskless/` (the migration's `from` is above `0`).
- Any other command pin SHALL be reported with reason `stale` when its spec is bounded and cannot reach the running version.

A bounded spec is an exact version (optionally prefixed `=` or `v`, prerelease, and build metadata), or a `^` or `~` range. An exact version SHALL be compared with semver precedence, so a prerelease sorts before its release and two prereleases of one base compare by their prerelease text, which orders nightlies by build time. A range SHALL be compared by its exclusive ceiling on the numeric core, with caret ranges holding the left-most non-zero part as npm does. A spec the CLI cannot bound (`latest`, `*`, a comparator range) SHALL NOT be reported as `stale`. An absent or unparseable file, or an unreadable installed manifest, SHALL produce no report from that source and SHALL NOT fail the install.

Entries SHALL be reported root `package.json` first, then workspace manifests by path, then CI and hook files by path; within a `package.json`, dependency fields, then scripts. A `package.json` entry's `manifest` is that file's `/`-separated path relative to the working directory and its `location` the dependency field or `scripts.<name>`; a CI or hook entry's `manifest` is the file's root-relative `/`-separated path, its `location` `line <n>`, and its `installed` `null`.

The install SHALL NOT modify any `package.json`, CI file, or hook. The report SHALL offer each change rather than claim it.

On the human path (batch and wizard), when at least one entry is reported, the CLI SHALL print a notice, introduced without naming `package.json` alone, naming for each entry its manifest, location, package, spec, installed version when known, and what to do: remove the dependency for `dependency`; leave it as is for `unreleased`; for `stale` and `nightly`, the running version on the package that publishes it (`@taskless/cli-nightly` under a nightly, `@taskless/cli` under a release), with the switch named when the pin is on the other package. The notice SHALL add one paragraph per reason present: for `dependency`, that Taskless runs through the project launcher, and the offer to remove it, point callers of its binary at the launcher, and reinstall dependencies; for `nightly`, that the pin keeps a prerelease after the move back to the release; for `unreleased`, that a nightly leaves release pins alone but a release predating the new schema refuses the project, and that the user should be told before committing `.taskless/`. Only a `dependency` entry SHALL ask for dependencies to be reinstalled. The notice SHALL print whether or not the run changed anything. On the batch path it SHALL print after the upgrade trailer, and the onboarding trailer SHALL remain the final line.

When the same run migrated an existing `.taskless/` and a `stale` or `dependency` entry is reported, the notice SHALL NOT hedge. It SHALL name the schema versions the run moved between, state that a CLI predating the new schema refuses the project with `SCAFFOLD_VERSION_MISMATCH` so CI running those entries will break on the push carrying the migrated files, and say the change belongs in the same commit as `.taskless/`. A migration from `0` is how a fresh install creates `.taskless/`; it SHALL NOT be described as an upgrade, and like a run with no migration the notice SHALL describe a `stale` entry's failure as likely, not certain.

Under `--json`, the envelope SHALL carry `pinnedCli`: an array of `{ manifest, location, name, spec, installed, reason }`, `reason` one of `dependency`, `stale`, `nightly`, `unreleased`, present on every successful run and empty when nothing is raised.

#### Scenario: A dependency and a stale script pin are named and left alone

- **WHEN** `taskless init` runs at release `V` in a project whose `package.json` has `devDependencies["@taskless/cli"]` set, and a script running `npx @taskless/cli@<older>`
- **THEN** stdout SHALL name the dependency for removal and the script with the target `@taskless/cli@V`
- **AND** `package.json` SHALL be byte-identical afterwards
- **AND** the notice SHALL appear after the upgrade trailer, with the onboarding trailer still the final line

#### Scenario: A current dependency is still raised

- **WHEN** `package.json` pins `@taskless/cli` at the running version, or at `latest`, `^0.11.0`, or `workspace:*`
- **THEN** it SHALL be reported with reason `dependency`

#### Scenario: A stale workflow pin is named by file and line

- **WHEN** `.github/workflows/taskless.yml` runs `npx @taskless/cli@0.11.0 check` on line 4 and the running CLI is `0.12.0`
- **THEN** `pinnedCli` SHALL contain `{ "manifest": ".github/workflows/taskless.yml", "location": "line 4", "name": "@taskless/cli", "spec": "0.11.0", "installed": null, "reason": "stale" }`
- **AND** the workflow file SHALL be byte-identical afterwards

#### Scenario: Hook files are read

- **WHEN** `.husky/pre-commit` or `lefthook.yml` spells out an older `@taskless/cli` or `@taskless/cli-nightly` version
- **THEN** each SHALL be reported with its path

#### Scenario: An older nightly pin is stale under a nightly

- **WHEN** a script pins `@taskless/cli-nightly` at `0.12.0-20260901000000xaaaaaaa` and the running CLI is `0.12.0-20261005000000xbbbbbbb`
- **THEN** it SHALL be reported with reason `stale`

#### Scenario: A nightly leaves a release pin alone

- **WHEN** a nightly runs `init` without migrating an existing `.taskless/`, and a script, CI file, or hook pins `@taskless/cli` at any version
- **THEN** that pin SHALL NOT be reported
- **AND** no notice SHALL offer to move a `@taskless/cli` pin onto `@taskless/cli-nightly`

#### Scenario: A nightly migration names the release pin without moving it

- **WHEN** a nightly `init` migrates an existing `.taskless/` from schema `M` above `0` to `N`, and a script pins `@taskless/cli`
- **THEN** that pin SHALL be reported with reason `unreleased`, its action "leave as is"
- **AND** the notice SHALL state that a release predating schema `N` refuses the project, and that the user should be told before committing `.taskless/`

#### Scenario: A release install raises a newer nightly pin

- **WHEN** a release `V` runs `init` and a CI file pins `@taskless/cli-nightly` at a version newer than `V`
- **THEN** it SHALL be reported with reason `nightly` and the target `@taskless/cli@V`, naming the package switch

#### Scenario: A self build moves no pin

- **WHEN** a self build at `0.13.0-self` runs `init` without migrating an existing `.taskless/`, and scripts pin `@taskless/cli` at `0.9.0` and `@taskless/cli-nightly` at an older nightly
- **THEN** neither pin SHALL be reported
- **AND** no notice SHALL name `0.13.0-self` as a version to move a pin to

#### Scenario: A floating or current command pin is not reported

- **WHEN** a script or CI file runs `@taskless/cli@latest`, or `@taskless/cli@<the running release>`
- **THEN** no entry SHALL be reported for it

#### Scenario: A migration of an existing scaffold makes the breakage definite

- **WHEN** `taskless init` migrates an existing `.taskless/` from schema version `M` above `0` to `N` in a project with a `stale` or `dependency` entry
- **THEN** the notice SHALL name schema versions `M` and `N` and `SCAFFOLD_VERSION_MISMATCH`
- **AND** SHALL state that CI running the entries will break, and that the change belongs in the same commit as `.taskless/`
- **AND** SHALL NOT describe the failure as merely likely

#### Scenario: A fresh install is not called an upgrade

- **WHEN** `taskless init` creates `.taskless/` in a project with a `stale` script pin
- **THEN** the notice SHALL describe the failure as likely
- **AND** SHALL NOT mention `SCAFFOLD_VERSION_MISMATCH` or describe the run as an upgrade

#### Scenario: An entry is named on a re-install that changed nothing

- **WHEN** `taskless init` runs against a project that is already current and holds a raised entry
- **THEN** stdout SHALL NOT contain the upgrade trailer
- **AND** stdout SHALL name the entry

#### Scenario: The JSON envelope carries the entries

- **WHEN** `taskless init --json` runs
- **THEN** the envelope SHALL contain `pinnedCli`, one `{ manifest, location, name, spec, installed, reason }` entry per raised entry
- **AND** `pinnedCli` SHALL be an empty array when nothing is raised

#### Scenario: A pin in a declared workspace package is named with its manifest

- **WHEN** `pnpm-workspace.yaml` declares `packages/*`, or the root `package.json` declares `workspaces` as `["packages/*"]` or `{ "packages": ["packages/*"] }`, and `packages/app/package.json` has `devDependencies["@taskless/cli"]`
- **THEN** the entry SHALL be reported with `manifest` set to `packages/app/package.json`
- **AND** the notice line SHALL name `packages/app/package.json` and the field

#### Scenario: A workspace dependency names the version it runs

- **WHEN** `packages/linked/package.json` and `packages/hoisted/package.json` both depend on `@taskless/cli`, `packages/linked/node_modules/@taskless/cli` is `0.11.0`, and only the root `node_modules/@taskless/cli` exists for `packages/hoisted` at `0.11.1`
- **THEN** `packages/linked/package.json` SHALL be reported with `installed` `0.11.0`
- **AND** `packages/hoisted/package.json` SHALL be reported with `installed` `0.11.1`

#### Scenario: Workspace expansion stays inside the project

- **WHEN** a workspace pattern is negated, is absolute, climbs out with `..`, or is `**` over a tree that contains `node_modules`
- **THEN** a directory the negation matches SHALL NOT be reported
- **AND** nothing outside the working directory, and no `package.json` under `node_modules`, SHALL be read as a workspace package
