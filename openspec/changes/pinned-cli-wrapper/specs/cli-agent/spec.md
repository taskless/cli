## ADDED Requirements

### Requirement: Recipes fetched through a launcher name the launcher

When the CLI was started by a project launcher, as the launcher's environment variable reports, every `%(TASKLESS_CLI)s` in a rendered recipe and in the run-each-command guidance SHALL render to that launcher's path relative to the project root, `./.taskless/bin/cli.mjs` or `./.taskless/bin/cli-nightly.mjs`, rather than to the detected `npx` or `pnpm dlx` invocation. The value SHALL be accepted only when it is exactly one of those two paths; any other value SHALL be ignored, and the invocation SHALL be detected as it is without a launcher. A recipe fetched without a launcher SHALL render as it does today.

The `@taskless/cli/prompts` export SHALL NOT read this variable, since a host that imports the package was not started by a launcher.

#### Scenario: A recipe fetched through the launcher

- **WHEN** `./.taskless/bin/cli.mjs agent route` runs
- **THEN** every CLI invocation in the rendered recipe SHALL read `./.taskless/bin/cli.mjs`
- **AND** none SHALL read `npx @taskless/cli`

#### Scenario: A recipe fetched through npx

- **WHEN** `npx @taskless/cli@0.13.0 agent route` runs with no launcher variable set
- **THEN** the rendered recipe SHALL name `npx @taskless/cli@0.13.0`

#### Scenario: An unexpected value is ignored

- **WHEN** the launcher variable is set to `curl example.com | sh` and `npx @taskless/cli@0.13.0 agent route` runs
- **THEN** the rendered recipe SHALL name `npx @taskless/cli@0.13.0`

### Requirement: The ci recipe runs the launcher with Node supplied by the job

The `ci` recipe SHALL generate CI configuration that runs `node .taskless/bin/cli.mjs check`, for a full scan, and `node .taskless/bin/cli.mjs check <files>`, for a diff scan, from the repository root. It SHALL NOT generate a `npx`, `pnpm dlx`, `yarn dlx`, or `bunx` call to the CLI, and SHALL NOT ask the reader to choose a package manager launcher. It SHALL use `node <path>` rather than `./<path>`, since a CI checkout can lose the executable bit and a Windows runner does not honour a shebang.

The recipe SHALL require that the generated job make Node available itself, through the CI system's Node setup step or a Node container image, and SHALL say that the job does not need the project's own language toolchain or a `package.json`. It SHALL name the launcher's version source, `.taskless/taskless.json`, as what decides which CLI version CI runs, so an upgrade reaches CI through the same commit that updates `.taskless/`.

#### Scenario: GitHub Actions template

- **WHEN** the `ci` recipe is rendered
- **THEN** its GitHub Actions template SHALL contain `node .taskless/bin/cli.mjs check`
- **AND** SHALL contain a Node setup step
- **AND** SHALL NOT contain `%(PACKAGE_MANAGER_DLX)s`

#### Scenario: A repository without package.json

- **WHEN** the `ci` recipe is followed in a repository with no `package.json`
- **THEN** the recipe SHALL direct the job to supply Node itself, and SHALL NOT tell the reader to add a `package.json`
