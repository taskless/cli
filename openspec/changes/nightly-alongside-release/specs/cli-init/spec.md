## REMOVED Requirements

### Requirement: Init names a package.json pin older than the running CLI

**Reason**: Replaced by "Init raises Taskless CLI pins". A dependency on the CLI is now raised whatever its version, and a version spelled out in a command is judged by channel as well as by version, so "older than the running CLI" no longer describes what is reported.

**Migration**: `pinnedCli` entries gain a `reason` field; every other field keeps its meaning.

### Requirement: Init names a CI or hook pin older than the running CLI

**Reason**: Folded into "Init raises Taskless CLI pins", which reads `package.json`, CI files, and hooks under one set of rules.

**Migration**: None; CI and hook entries keep their `manifest` and `line <n>` location.

### Requirement: Each permission file holds exactly one Taskless rule

**Reason**: Replaced by "Each permission file holds one Taskless rule set per installed package". A release install now removes the nightly's rules, so the two packages no longer keep each other's rules in both directions.

**Migration**: None for the release's rules. A release install removes `@taskless/cli-nightly` rules from the files it manages.

## ADDED Requirements

### Requirement: Init raises Taskless CLI pins

After a successful install, `taskless init` SHALL read `package.json` in the working directory, the `package.json` of every workspace package the working directory declares, and the project's CI and git-hook configuration files, and report every entry naming `@taskless/cli` or `@taskless/cli-nightly` that this requirement raises, each with a `reason`.

Workspace packages are declared by the `packages` list of `pnpm-workspace.yaml` and by the `workspaces` field of the root `package.json`, as an array or as `{ packages }`; both sources SHALL be read. A pattern SHALL name each directory it matches that holds a `package.json`. A pattern prefixed `!` SHALL remove the directories it matches. A pattern that is absolute or contains a `..` segment SHALL be skipped. Expansion SHALL NOT descend into `node_modules` or `.git`, and SHALL stop after a fixed number of manifests. The root SHALL be read once even when a pattern names it. An absent or malformed workspace declaration SHALL declare nothing, and a malformed root `package.json` SHALL NOT stop `pnpm-workspace.yaml` from being read.

The CI and hook files read SHALL be the ones `detect` recognizes as CI and commit-time configuration at the project root: `.github/workflows/*.yml` and `*.yaml`, `.gitlab-ci.yml`, `.circleci/config.yml`, `Jenkinsfile`, `azure-pipelines.yml` and `.yaml`, `bitbucket-pipelines.yml`, `.drone.yml`, `.travis.yml`, the files directly in `.buildkite/` and `.husky/`, the lefthook, pre-commit, simple-git-hooks, and lint-staged config files.

An entry is:

- a dependency: an entry in `dependencies`, `devDependencies`, or `optionalDependencies`; or
- a command pin: a `package.json` script, or a line of a CI or hook file, that spells out `@taskless/cli@<spec>` or `@taskless/cli-nightly@<spec>`, where the name is not the tail of a longer name and the spec ends at whitespace, a quote, or shell punctuation (`;&|()<>,:`). A pin repeated within one script SHALL be reported once, and a pin repeated within one CI or hook file once, at its first line.

Every dependency SHALL be reported with reason `dependency`, whatever its spec, its package, or the running channel, because the CLI runs through the project launcher and a dependency stays on the build its lockfile resolved. Its `installed` SHALL be the version read from `node_modules/<name>/package.json` in the directory holding it, then in each parent up to the working directory, the first found winning, as Node resolves it; `null` when none is found.

A command pin SHALL be judged by the running channel first. The running CLI is a nightly when its version carries a prerelease, and a release otherwise.

- Under a nightly, a `@taskless/cli` command pin SHALL NOT be reported, because a nightly installs beside the release, except that when the same run migrated an existing `.taskless/` (the migration's `from` is above `0`) it SHALL be reported with reason `unreleased`.
- Under a release, a `@taskless/cli-nightly` command pin SHALL be reported with reason `nightly`, whatever its version, because a release install is the move back to mainline.
- Any other command pin SHALL be reported with reason `stale` when its spec is bounded and cannot reach the running version.

A bounded spec is an exact version (optionally prefixed `=` or `v`, prerelease, and build metadata), or a `^` or `~` range. An exact version SHALL be compared with semver precedence, so a prerelease sorts before its release and two prereleases of one base compare by their prerelease text, which orders nightlies by build time. A range SHALL be compared by its exclusive ceiling on the numeric core, with caret ranges holding the left-most non-zero part as npm does. A spec the CLI cannot bound (`latest`, `*`, a comparator range) SHALL NOT be reported as `stale`. An absent or unparseable file, or an unreadable installed manifest, SHALL produce no report from that source and SHALL NOT fail the install.

Entries SHALL be reported root `package.json` first, then workspace manifests by path, then CI and hook files by path; within a `package.json`, dependency fields, then scripts. A `package.json` entry's `manifest` is that file's `/`-separated path relative to the working directory and its `location` the dependency field or `scripts.<name>`; a CI or hook entry's `manifest` is the file's root-relative `/`-separated path, its `location` `line <n>`, and its `installed` `null`.

The install SHALL NOT modify any `package.json`, CI file, or hook. The report SHALL offer each change rather than claim it.

On the human path (batch and wizard), when at least one entry is reported, the CLI SHALL print a notice, introduced without naming `package.json` alone, naming for each entry its manifest, location, package, spec, installed version when known, and what to do: remove the dependency for `dependency`; leave it as is for `unreleased`; for `stale` and `nightly`, the running version on the package that publishes it (`@taskless/cli-nightly` when the running version carries a prerelease, `@taskless/cli` otherwise), with the switch named when the pin is on the other package. The notice SHALL add one paragraph per reason present: for `dependency`, that Taskless runs through the project launcher, and the offer to remove it, point callers of its binary at the launcher, and reinstall dependencies; for `nightly`, that the pin keeps a prerelease after the move back to the release; for `unreleased`, that a nightly leaves release pins alone but a release predating the new schema refuses the project, and that the user should be told before committing `.taskless/`. Only a `dependency` entry SHALL ask for dependencies to be reinstalled. The notice SHALL print whether or not the run changed anything. On the batch path it SHALL print after the upgrade trailer, and the onboarding trailer SHALL remain the final line.

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

### Requirement: Each permission file holds one Taskless rule set per installed package

Each harness permission file `init` manages SHALL hold, afterwards, the installed invocation's package's rules: the rules for the installed invocation, from the table in the requirement that init allows the installed CLI, and the rule for its launcher, from the requirement that init allows the installed launcher. A Taskless rule is an allow entry, in that harness's format, whose command is an invocation of `@taskless/cli` or `@taskless/cli-nightly` through `npx` or `pnpm dlx`, at any version, with or without a version, or whose command is a launcher path `./.taskless/bin/cli.mjs` or `./.taskless/bin/cli-nightly.mjs`. A rule belongs to the package its command names; `cli.mjs` belongs to `@taskless/cli` and `cli-nightly.mjs` to `@taskless/cli-nightly`. For Claude Code this includes both the `Bash(<invocation> *)` form and the `Bash(<invocation>:*)` form. On every `init` the installer SHALL remove each Taskless rule of the installed invocation's package that is not one of the installed invocation's rules, whether or not the manifest recorded it, and write the current ones.

The two packages are not symmetric. A nightly `init` SHALL NOT remove a `@taskless/cli` rule, so a nightly installs beside the release. A release `init` is the move back to mainline: it SHALL remove every `@taskless/cli-nightly` rule in the files it visits, whether or not the manifest recorded it. An invocation that names neither package, such as a `self` build's path, SHALL remove no Taskless rule. The installer SHALL NOT remove or edit a deny entry, or any entry that is not a Taskless rule.

The manifest SHALL record, under `install.permissions`, each file Taskless wrote a rule to, the exact rule entries it added, and whether Taskless created the file. The record decides only whether a file may be deleted: a file Taskless created SHALL be deleted when removing its entries leaves it holding nothing else; a file that existed before SHALL never be deleted. A recorded file for a harness no longer selected SHALL have the installed package's Taskless rules removed, and, on a release `init`, the nightly's. A nightly `init` SHALL keep the release's recorded rules, so a file Taskless created is deleted once the last package's rules leave it.

#### Scenario: An upgrade swaps the version

- **WHEN** the manifest records `Bash(npx @taskless/cli@0.13.0 *)` in `.claude/settings.json` and `init` runs at `0.13.1`
- **THEN** the file SHALL contain `Bash(npx @taskless/cli@0.13.1 *)` and not the `0.13.0` rule
- **AND** the manifest SHALL record only the `0.13.1` rule

#### Scenario: An unrecorded Taskless rule is replaced

- **WHEN** `.claude/settings.json` also holds `Bash(npx @taskless/cli@0.12.0 *)`, which the manifest does not record
- **THEN** an upgrade SHALL remove that entry
- **AND** the file SHALL hold exactly one Taskless rule, for the installed invocation

#### Scenario: The colon form the skill proposed is replaced

- **WHEN** `.claude/settings.json` holds `Bash(npx @taskless/cli-nightly@0.13.0-20261015220659xbf27a23:*)` and a nightly `init` runs
- **THEN** `init` SHALL remove it and write the installed invocation's rule

#### Scenario: Other entries are untouched

- **WHEN** `.claude/settings.json` holds `Bash(npx prettier *)` and a deny entry `Bash(npx @taskless/cli@0.11.0 *)`
- **THEN** `init` SHALL leave both entries in place

#### Scenario: A pre-existing file is never deleted

- **WHEN** removing Taskless rules from a `.claude/settings.json` that Taskless did not create leaves its `permissions.allow` empty
- **THEN** the file SHALL remain

#### Scenario: A nightly installs beside the release's rules

- **WHEN** `init` at `npx @taskless/cli@0.13.0` has written its rule, and a nightly `init` then runs
- **THEN** `.claude/settings.json` SHALL hold the release's rule and the nightly's rule
- **AND** running the nightly's `init` again SHALL report no edit

#### Scenario: A release install removes the nightly's rules

- **WHEN** `.claude/settings.json` holds the release's rules and a nightly's, recorded or not, and the release's `init` runs
- **THEN** every `@taskless/cli-nightly` rule, including `Bash(./.taskless/bin/cli-nightly.mjs *)`, SHALL be removed and reported as removed
- **AND** the release's rules SHALL remain

#### Scenario: A nightly upgrade swaps only the nightly's rule

- **WHEN** `.claude/settings.json` holds the release's rule and an older nightly's rule, and a newer nightly `init` runs
- **THEN** the older nightly rule SHALL be removed and the newer one written
- **AND** the release's rule SHALL remain

#### Scenario: A created file outlives the nightly's removal

- **WHEN** Taskless created `.claude/settings.json` holding the release's and a nightly's rules, and the nightly's `init` runs with `.claude/` no longer selected
- **THEN** the file SHALL remain, holding the release's rule
- **AND** once the release's `init` runs the same way, the file SHALL be deleted

#### Scenario: Removing a harness removes its launcher rule

- **WHEN** the manifest records `Bash(./.taskless/bin/cli-nightly.mjs *)` in `.claude/settings.json` and the nightly's `init` runs with `.claude/` no longer selected
- **THEN** that rule SHALL be removed with the nightly's other Taskless rules
- **AND** `Bash(./.taskless/bin/cli.mjs *)` SHALL remain

## MODIFIED Requirements

### Requirement: Init installs the package's launcher and records its version

Every `init` that writes the canonical skill, in the wizard and in `--no-interactive`, SHALL also write this build's launcher, as defined by the `cli-project-launcher` capability, and record this build's version for its package under `install.launchers` in `.taskless/taskless.json`, keyed by package name. `install.cliVersion` SHALL keep recording the build that last installed.

A nightly `init` SHALL keep the release's recorded version. Where the release's version was recorded only as `install.cliVersion` (a manifest written before `install.launchers` existed), the nightly `init` SHALL carry it into `install.launchers` before overwriting `install.cliVersion`, so `.taskless/bin/cli.mjs` keeps a version to run.

A release `init` is the move back to mainline, and SHALL retire the nightly: it SHALL drop `@taskless/cli-nightly` from `install.launchers`, and remove `.taskless/bin/cli-nightly.mjs` and `.taskless/bin/cli-nightly.lock.json` when they exist. The cached nightly build is then pruned, since nothing records it. Each file removed SHALL be named in the install summary and listed in `init --json` as `retired`, an array of root-relative paths present on every successful run and empty when nothing was removed, and a removal SHALL count as a change. The release `init` SHALL NOT touch the user-level global trust entry, which other projects may still use.

A launcher whose bytes differ from this build's launcher SHALL be rewritten, and the install summary SHALL name it as restored, since a launcher runs whatever it contains under any rule that allows it. A `self` build SHALL write no launcher, record no version under `install.launchers`, and retire nothing.

No scaffold migration SHALL be added for this: the launcher and its record are install output, written by the same step as the canonical skill.

#### Scenario: A release install records its version

- **WHEN** `init` runs from the release at `0.13.0` in a project with no `install.launchers`
- **THEN** `install.launchers` SHALL be `{ "@taskless/cli": "0.13.0" }`
- **AND** `install.cliVersion` SHALL be `0.13.0`

#### Scenario: A nightly install keeps the release's version

- **WHEN** `install.launchers` is `{ "@taskless/cli": "0.13.0" }` and a nightly `init` runs at `0.14.0-20261020120000xabc1234`
- **THEN** `install.launchers` SHALL be `{ "@taskless/cli": "0.13.0", "@taskless/cli-nightly": "0.14.0-20261020120000xabc1234" }`
- **AND** `install.cliVersion` SHALL be `0.14.0-20261020120000xabc1234`

#### Scenario: A nightly install keeps a release version only cliVersion recorded

- **WHEN** `.taskless/taskless.json` records `install.cliVersion` `0.13.0` and no `install.launchers`, and a nightly `init` runs at `0.14.0-20261020120000xabc1234`
- **THEN** `install.launchers` SHALL be `{ "@taskless/cli": "0.13.0", "@taskless/cli-nightly": "0.14.0-20261020120000xabc1234" }`

#### Scenario: A release install retires the nightly

- **WHEN** `install.launchers` records `@taskless/cli-nightly`, `.taskless/bin/cli-nightly.mjs` and `cli-nightly.lock.json` exist, and the release's `init` runs at `0.13.0`
- **THEN** `install.launchers` SHALL be `{ "@taskless/cli": "0.13.0" }`
- **AND** both nightly files SHALL be gone and listed in `retired`
- **AND** the nightly's cache entry SHALL be pruned

#### Scenario: An edited launcher is restored and reported

- **WHEN** `.taskless/bin/cli.mjs` was edited and the release's `init` runs
- **THEN** the file SHALL hold this build's launcher afterwards
- **AND** the summary SHALL name `.taskless/bin/cli.mjs` as restored

### Requirement: Init writes the package's lockfile beside its launcher

Every `init` that writes a launcher SHALL also write this build's lockfile for the same package beside it: `.taskless/bin/cli.lock.json` for the release and `.taskless/bin/cli-nightly.lock.json` for the nightly. A nightly `init` SHALL NOT write, change or remove the release's lockfile. A release `init` SHALL NOT write or change the nightly's lockfile, and SHALL remove it as part of retiring the nightly, under the requirement that init installs the package's launcher. A lockfile whose bytes differ from this build's SHALL be rewritten, and the install summary SHALL name it as restored. A `self` build SHALL write no lockfile. No scaffold migration SHALL be added for this.

#### Scenario: A release install writes its lockfile

- **WHEN** the release's `init` runs at `0.13.1`
- **THEN** `.taskless/bin/cli.lock.json` SHALL hold this build's lockfile, naming `@taskless/cli` at `0.13.1`

#### Scenario: A nightly install leaves the release's lockfile alone

- **WHEN** `.taskless/bin/cli.lock.json` exists and a nightly `init` runs
- **THEN** `.taskless/bin/cli-nightly.lock.json` SHALL be written
- **AND** `.taskless/bin/cli.lock.json` SHALL be unchanged

#### Scenario: An edited lockfile is restored and reported

- **WHEN** `.taskless/bin/cli.lock.json` was edited and the release's `init` runs
- **THEN** the file SHALL hold this build's lockfile afterwards
- **AND** the summary SHALL name it as restored
