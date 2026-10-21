## ADDED Requirements

### Requirement: Follow-up commands after an install name the project launcher

When the CLI prints a command for its reader to run next in an installed project, other than `init`, it SHALL name the project launcher (`./.taskless/bin/cli.mjs`, or `cli-nightly.mjs` for the nightly) rather than an npx or `pnpm dlx` invocation. npx is for installing and upgrading only. A build with no launcher SHALL name its own invocation.

#### Scenario: The upgrade trailer names the launcher

- **WHEN** `npx @taskless/cli@0.14.0 init` runs in a project that recorded `0.13.0`
- **THEN** the trailer SHALL say to run `./.taskless/bin/cli.mjs update`
- **AND** it SHALL NOT say to run `npx @taskless/cli@0.14.0 update`

#### Scenario: The bare notice sends recipes to the launcher

- **WHEN** the CLI runs with no subcommand, outside a terminal, in a project that has `.taskless/bin/cli.mjs`
- **THEN** the notice SHALL say to run `./.taskless/bin/cli.mjs agent` for recipes
- **AND** the scripted-install line SHALL still name the invocation that ran it, followed by `init`

#### Scenario: A directory with no launcher keeps the running invocation

- **WHEN** the CLI runs with no subcommand, outside a terminal, in a directory with no launcher
- **THEN** the notice SHALL name the running invocation for both `init` and `agent`
