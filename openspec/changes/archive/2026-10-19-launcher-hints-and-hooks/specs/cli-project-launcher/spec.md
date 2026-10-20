## ADDED Requirements

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
