## MODIFIED Requirements

### Requirement: Info reports stale CLI pins

`taskless info` SHALL report the same entries `taskless init` reports under "Init raises Taskless CLI pins", judged against the running version, read from the working directory, its declared workspace packages, and its CI and hook files by the same rules. `info` runs no migration, so it SHALL never report reason `unreleased`. Under `--json` the payload SHALL carry `pinnedCli` in the shape `init --json` uses, `{ manifest, location, name, spec, installed, reason }`, present on every successful run and empty when nothing is raised. Without `--json`, when at least one entry is reported, the output SHALL list each entry with its manifest, location, spec, installed version when known, and what to do with it.

`info` is read-only: it SHALL NOT modify any `package.json`, CI file, or hook, and an unreadable file SHALL NOT make it fail. `--anonymous` SHALL NOT suppress the entries, since they are local state.

The `update` recipe SHALL read the entries from `info --json`, the read-only command it already runs, rather than directing an agent to re-run `init`.

#### Scenario: info --json carries a workspace package's stale pin

- **WHEN** `taskless info --json` runs in a project whose root `package.json` declares `workspaces: ["packages/*"]` and `packages/app/package.json` has `devDependencies["@taskless/cli"]`
- **THEN** `pinnedCli` SHALL contain `{ manifest: "packages/app/package.json", location: "devDependencies", name: "@taskless/cli", spec, installed: null, reason: "dependency" }`

#### Scenario: info --json reports no pins as an empty list

- **WHEN** `taskless info --json` runs where nothing is raised
- **THEN** `pinnedCli` SHALL be an empty array

#### Scenario: Plain info lists the pins

- **WHEN** `taskless info` runs without `--json` and an entry is raised
- **THEN** stdout SHALL name the entry's manifest, location, and spec, and what to do with it
