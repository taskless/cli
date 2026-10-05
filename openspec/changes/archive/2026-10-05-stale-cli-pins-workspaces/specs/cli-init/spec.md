## MODIFIED Requirements

### Requirement: Init names a package.json pin older than the running CLI

After a successful install, `taskless init` SHALL read `package.json` in the working directory, and the `package.json` of every workspace package the working directory declares, and report every pin of `@taskless/cli` or `@taskless/cli-nightly` that would run a CLI older than the running one.

Workspace packages are declared by the `packages` list of `pnpm-workspace.yaml` and by the `workspaces` field of the root `package.json`, as an array or as `{ packages }`; both sources SHALL be read. A pattern SHALL name each directory it matches that holds a `package.json`. A pattern prefixed `!` SHALL remove the directories it matches. A pattern that is absolute or contains a `..` segment SHALL be skipped. Expansion SHALL NOT descend into `node_modules` or `.git`, and SHALL stop after a fixed number of manifests. The root SHALL be read once even when a pattern names it. An absent or malformed workspace declaration SHALL declare nothing, and a malformed root `package.json` SHALL NOT stop `pnpm-workspace.yaml` from being read.

A pin is:

- an entry in `dependencies`, `devDependencies`, or `optionalDependencies`; or
- a script in `scripts` that spells out `@taskless/cli@<spec>` or `@taskless/cli-nightly@<spec>`, where the name is not the tail of a longer name and the spec ends at whitespace, a quote, or shell punctuation (`;&|()<>,:`). A pin repeated within one script SHALL be reported once.

A dependency pin SHALL be reported when either holds:

- the version installed for that package is older than the running version, because that, and the lockfile it came from, is what runs. It SHALL be read from `node_modules/<name>/package.json` in the directory holding the pin, then in each parent up to the working directory, the first found winning, as Node resolves it: a workspace package's own link under pnpm, the hoisted root copy under npm or yarn; or
- its spec is bounded and cannot reach the running version.

A script pin SHALL be reported when its spec is bounded and cannot reach the running version.

A bounded spec is an exact version (optionally prefixed `=` or `v`, with optional whitespace after the operator, prerelease, and build metadata), or a `^` or `~` range. An exact version, and an installed version, SHALL be compared with semver precedence, so a prerelease sorts before its release and two prereleases of one base compare by their prerelease text, which orders nightlies by build time. A range SHALL be compared by its exclusive ceiling on the numeric core, with caret ranges holding the left-most non-zero part as npm does. A spec the CLI cannot bound (`latest`, `*`, a comparator range, `workspace:`, a URL or git spec) SHALL NOT be reported on its own. An absent or unparseable `package.json`, or an unreadable installed manifest, SHALL produce no report from that source and SHALL NOT fail the install.

Pins SHALL be reported root first, then by workspace manifest path, each manifest's in file order: dependency fields, then scripts.

The install SHALL NOT modify any `package.json`. The report SHALL offer the bump rather than claim it.

On the human path (batch and wizard), when at least one pin is reported, the CLI SHALL print a notice naming, for each pin, its manifest path relative to the working directory, its location in that manifest (the dependency field, or `scripts.<name>`), package, spec, installed version when known, and the package and version to move it to. The target SHALL be the running version on the package that publishes it: `@taskless/cli-nightly` when the running version carries a prerelease, `@taskless/cli` otherwise, with the switch named when the pin is on the other package. The notice SHALL print whether or not the run changed anything. On the batch path it SHALL print after the upgrade trailer, and the onboarding trailer SHALL remain the final line.

When the same run migrated an existing `.taskless/` (the migration's `from` is above `0`), the notice SHALL NOT hedge. It SHALL name the schema versions the run moved between, state that a CLI predating the new schema refuses the project with `SCAFFOLD_VERSION_MISMATCH` so CI running the pins will break on the push carrying the migrated files, and say the bump belongs in the same commit as `.taskless/`. A migration from `0` is how a fresh install creates `.taskless/`; it SHALL NOT be described as an upgrade, and like a run with no migration the notice SHALL describe the failure as likely, not certain.

Under `--json`, the envelope SHALL carry `pinnedCli`: an array of `{ manifest, location, name, spec, installed }`, where `manifest` is the `/`-separated path of the `package.json` holding the pin relative to the working directory, `installed` is the installed version or `null`, present on every successful run and empty when nothing is stale.

#### Scenario: A stale dependency and script pin are named and left alone

- **WHEN** `taskless init` runs at version `V` in a project whose `package.json` has `devDependencies["@taskless/cli"]` set to a version below `V`, and a script running `npx @taskless/cli@<older>`
- **THEN** stdout SHALL name both pins with their location and spec, and the target `@taskless/cli@V`
- **AND** `package.json` SHALL be byte-identical afterwards
- **AND** the notice SHALL appear after the upgrade trailer, with the onboarding trailer still the final line

#### Scenario: An installed build older than the running CLI is stale even when its range admits the running version

- **WHEN** `package.json` pins `@taskless/cli` at `^0.11.0`, `node_modules/@taskless/cli` is `0.11.0`, and the running CLI is `0.11.2`
- **THEN** the pin SHALL be reported with `installed` set to `0.11.0`

#### Scenario: A pre-1.0 caret range that cannot reach the running version is stale

- **WHEN** `package.json` pins `@taskless/cli` at `^0.10.2`, nothing is installed, and the running CLI is `0.11.2`
- **THEN** the pin SHALL be reported

#### Scenario: An older nightly of the same base is stale

- **WHEN** `package.json` pins `@taskless/cli-nightly` at `0.12.0-20260901000000xaaaaaaa` and the running CLI is `0.12.0-20261005000000xbbbbbbb` or `0.12.0`
- **THEN** the pin SHALL be reported

#### Scenario: A nightly pin moves to the release package when a release is running

- **WHEN** a stale pin names `@taskless/cli-nightly` and the running CLI is a release `V`
- **THEN** the notice SHALL give `@taskless/cli@V` as the target and name the package switch

#### Scenario: A floating or current pin is not reported

- **WHEN** nothing older than the running version is installed, and `package.json` pins `@taskless/cli` at `latest`, `*`, `>=0.10.0`, `workspace:*`, or a range that admits the running version, or a script runs `@taskless/cli@latest`
- **THEN** no pin SHALL be reported

#### Scenario: A migration of an existing scaffold makes the breakage definite

- **WHEN** `taskless init` migrates an existing `.taskless/` from schema version `M` above `0` to `N` in a project with a stale pin
- **THEN** the notice SHALL name schema versions `M` and `N` and `SCAFFOLD_VERSION_MISMATCH`
- **AND** SHALL state that CI running the pins will break, and that the bump belongs in the same commit as `.taskless/`
- **AND** SHALL NOT describe the failure as merely likely

#### Scenario: A fresh install is not called an upgrade

- **WHEN** `taskless init` creates `.taskless/` in a project with a stale pin
- **THEN** the notice SHALL describe the failure as likely
- **AND** SHALL NOT mention `SCAFFOLD_VERSION_MISMATCH` or describe the run as an upgrade

#### Scenario: A stale pin is named on a re-install that changed nothing

- **WHEN** `taskless init` runs against a project that is already current and whose `package.json` holds a stale pin
- **THEN** stdout SHALL NOT contain the upgrade trailer
- **AND** stdout SHALL name the stale pin

#### Scenario: The JSON envelope carries the pins

- **WHEN** `taskless init --json` runs
- **THEN** the envelope SHALL contain `pinnedCli`, an array with one `{ manifest, location, name, spec, installed }` entry per stale pin
- **AND** `pinnedCli` SHALL be an empty array when there is no `package.json` or nothing in it is stale

#### Scenario: A pin in a declared workspace package is named with its manifest

- **WHEN** `pnpm-workspace.yaml` declares `packages/*`, or the root `package.json` declares `workspaces` as `["packages/*"]` or `{ "packages": ["packages/*"] }`, and `packages/app/package.json` pins `@taskless/cli` at a version below the running one
- **THEN** the pin SHALL be reported with `manifest` set to `packages/app/package.json`
- **AND** the notice line SHALL name `packages/app/package.json` and the field

#### Scenario: A workspace package is judged by the version it runs

- **WHEN** `packages/linked/package.json` and `packages/hoisted/package.json` both pin `@taskless/cli` at `^0.11.0`, `packages/linked/node_modules/@taskless/cli` is `0.11.0`, only the root `node_modules/@taskless/cli` exists for `packages/hoisted` at `0.11.1`, and the running CLI is `0.11.2`
- **THEN** `packages/linked/package.json` SHALL be reported with `installed` `0.11.0`
- **AND** `packages/hoisted/package.json` SHALL be reported with `installed` `0.11.1`

#### Scenario: Workspace expansion stays inside the project

- **WHEN** a workspace pattern is negated, is absolute, climbs out with `..`, or is `**` over a tree that contains `node_modules`
- **THEN** a directory the negation matches SHALL NOT be reported
- **AND** nothing outside the working directory, and no `package.json` under `node_modules`, SHALL be read as a workspace package
