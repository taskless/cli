## ADDED Requirements

### Requirement: Info reports stale CLI pins

`taskless info` SHALL report the same pins `taskless init` reports under "Init names a package.json pin older than the running CLI", judged against the running version, read from the working directory and its declared workspace packages by the same rules. Under `--json` the payload SHALL carry `pinnedCli` in the shape `init --json` uses, `{ manifest, location, name, spec, installed }`, present on every successful run and empty when nothing is stale. Without `--json`, when at least one pin is reported, the output SHALL list each pin with its manifest, location, spec, installed version when known, and the package and version to move it to.

`info` is read-only: it SHALL NOT modify any `package.json`, and an unreadable manifest SHALL NOT make it fail. `--anonymous` SHALL NOT suppress the pins, since they are local state.

The `update` recipe SHALL read the pins from `info --json`, the read-only command it already runs, rather than directing an agent to re-run `init`.

#### Scenario: info --json carries a workspace package's stale pin

- **WHEN** `taskless info --json` runs in a project whose root `package.json` declares `workspaces: ["packages/*"]` and `packages/app/package.json` pins `@taskless/cli` at a version below the running one
- **THEN** `pinnedCli` SHALL contain `{ manifest: "packages/app/package.json", location: "devDependencies", name: "@taskless/cli", spec, installed: null }`

#### Scenario: info --json reports no pins as an empty list

- **WHEN** `taskless info --json` runs where there is no `package.json`, or nothing in one is stale
- **THEN** `pinnedCli` SHALL be an empty array

#### Scenario: Plain info lists the pins

- **WHEN** `taskless info` runs without `--json` and a pin is stale
- **THEN** stdout SHALL name the pin's manifest, location, and spec, and the version to move it to
