## ADDED Requirements

### Requirement: The hooks recipe runs the launcher

The `hooks` recipe SHALL generate pre-commit commands that run `node .taskless/bin/cli.mjs`, for every hook tool it covers. It SHALL NOT tell the reader to add `@taskless/cli` as a dev dependency for the hook, SHALL NOT resolve a binary from `node_modules/.bin`, and SHALL NOT call `npx`, `pnpm dlx`, `yarn dlx`, or `bunx`, since the launcher already runs the version recorded in `.taskless/taskless.json`. It SHALL require that `.taskless/bin/cli.mjs` exists and is committed, and SHALL say what to do when `.taskless/` is not at the repository root, where git runs hooks.

#### Scenario: Every hook tool runs the launcher

- **WHEN** the `hooks` recipe is rendered
- **THEN** its lint-staged, lefthook, pre-commit, and husky examples SHALL each run `node .taskless/bin/cli.mjs check`
- **AND** it SHALL NOT mention a dev dependency as a step

#### Scenario: A missing launcher

- **WHEN** the `hooks` recipe is followed in a project with no `.taskless/bin/cli.mjs`
- **THEN** it SHALL direct the reader to run the installer and commit the result before writing a hook
