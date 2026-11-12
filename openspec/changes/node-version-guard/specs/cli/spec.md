## ADDED Requirements

### Requirement: The bin checks the Node version before loading the CLI

The package `bin` SHALL be a separate built file from the CLI entry. It SHALL compare the running Node version against the package's `engines.node` before it loads any of the CLI, and SHALL load the CLI with a dynamic `import()` only when the version satisfies it, so that an older Node never links the CLI's module graph. When the version does not satisfy it, the `bin` SHALL write one line to standard error naming the required range and the running version, write nothing to standard output, and exit with code 1. A range other than a `>=` lower bound SHALL NOT stop the CLI.

#### Scenario: npx on Node 20

- **WHEN** a user runs `npx @taskless/cli init` on Node 20.19.0 and `engines.node` is `>=22.22.0`
- **THEN** standard error SHALL be `taskless: Taskless needs Node >=22.22.0, you have 20.19.0. Install a newer Node and run it again.`
- **AND** the process SHALL exit with code 1 without loading the CLI

#### Scenario: A satisfying Node runs the CLI

- **WHEN** the running Node satisfies `engines.node`
- **THEN** the `bin` SHALL run the CLI with every argument unchanged
