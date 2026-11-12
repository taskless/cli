## ADDED Requirements

### Requirement: A launcher refuses a Node older than its package needs

Before it installs a version, a launcher SHALL compare the running Node against the `engines.node` its lockfile records for the package, and before it runs an installed version, against the `engines.node` in that version's `package.json`. When either is a `>=` lower bound the running Node does not meet, the launcher SHALL write `taskless: Taskless needs Node <range>, you have <version>. Install a newer Node and run it again.` to standard error and exit with code 1, without installing and without starting the CLI. A range other than a `>=` lower bound, or none, SHALL NOT stop it.

#### Scenario: First run on Node 20

- **WHEN** a launcher whose lockfile records `engines.node` `>=22.22.0` runs on Node 20.19.0 with nothing installed
- **THEN** it SHALL print the message naming `>=22.22.0` and `20.19.0` and exit with code 1
- **AND** it SHALL NOT run npm

#### Scenario: An installed version on an older Node

- **WHEN** a version installed under a newer Node is run by the launcher on a Node older than its `engines.node`
- **THEN** the launcher SHALL print the message and exit with code 1 without starting the CLI
