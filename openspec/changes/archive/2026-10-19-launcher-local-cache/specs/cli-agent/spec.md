## MODIFIED Requirements

### Requirement: The ci recipe runs the launcher with Node supplied by the job

The `ci` recipe SHALL generate CI configuration that runs `node .taskless/bin/cli.mjs check`, for a full scan, and `node .taskless/bin/cli.mjs check <files>`, for a diff scan, from the repository root. It SHALL NOT generate a `npx`, `pnpm dlx`, `yarn dlx`, or `bunx` call to the CLI, and SHALL NOT ask the reader to choose a package manager launcher. It SHALL use `node <path>` rather than `./<path>`, since a CI checkout can lose the executable bit and a Windows runner does not honour a shebang.

The recipe SHALL require that the generated job make Node available itself, through the CI system's Node setup step or a Node container image, and SHALL say that the job does not need the project's own language toolchain or a `package.json`. It SHALL name the launcher's version source, `.taskless/taskless.json`, as what decides which CLI version CI runs, so an upgrade reaches CI through the same commit that updates `.taskless/`.

The recipe SHALL have the generated job cache `.taskless/.cache` between runs where the CI system supports a cache, with a key that includes the runner's operating system and a hash of `.taskless/bin/cli.lock.json`, so a restored cache never crosses platforms and an upgrade starts a fresh one.

#### Scenario: GitHub Actions template

- **WHEN** the `ci` recipe is rendered
- **THEN** its GitHub Actions template SHALL contain `node .taskless/bin/cli.mjs check`
- **AND** SHALL contain a Node setup step
- **AND** SHALL NOT contain `%(PACKAGE_MANAGER_DLX)s`

#### Scenario: A repository without package.json

- **WHEN** the `ci` recipe is followed in a repository with no `package.json`
- **THEN** the recipe SHALL direct the job to supply Node itself, and SHALL NOT tell the reader to add a `package.json`

#### Scenario: The launcher cache is restored between runs

- **WHEN** the `ci` recipe is rendered
- **THEN** its GitHub Actions template SHALL cache the path `.taskless/.cache`
- **AND** the cache key SHALL include `runner.os` and `hashFiles('.taskless/bin/cli.lock.json')`
