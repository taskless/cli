## ADDED Requirements

### Requirement: Init names a package.json pin older than the running CLI

After a successful install, `taskless init` SHALL read `package.json` in the working directory and report every pin of `@taskless/cli` or `@taskless/cli-nightly` that cannot resolve to the running CLI's version or later. A pin is:

- an entry in `dependencies`, `devDependencies`, or `optionalDependencies`; or
- a script in `scripts` that spells out `@taskless/cli@<spec>` or `@taskless/cli-nightly@<spec>`.

A pin SHALL be reported only when its spec is bounded and its bound sits below the running version: an exact version (optionally prefixed `=` or `v`), or a `^` or `~` range whose exclusive ceiling is at or below the running version, with caret ranges holding the left-most non-zero part as npm does. Versions SHALL be compared on their numeric core, ignoring a prerelease suffix. A spec the CLI cannot bound (`latest`, `*`, a comparator range, `workspace:`, a URL or git spec) SHALL NOT be reported. An absent or unparseable `package.json` SHALL produce no report and SHALL NOT fail the install.

The install SHALL NOT modify `package.json`. The report SHALL offer the bump rather than claim it.

On the human path (batch and wizard), when at least one pin is reported, the CLI SHALL print a notice naming each pin's location (the dependency field, or `scripts.<name>`), package and spec, stating that what runs those pins runs a CLI older than the project, and offering to update them to the running version. The notice SHALL print whether or not the run changed anything. On the batch path it SHALL print after the upgrade trailer, and the onboarding trailer SHALL remain the final line.

When the same run migrated `.taskless/`, the notice SHALL NOT hedge. It SHALL name the schema version the run wrote, state that a CLI predating that schema refuses the project with `SCAFFOLD_VERSION_MISMATCH` so CI running the pins will break on the push carrying the migrated files, and say the bump belongs in the same commit as `.taskless/`. Without a migration the notice SHALL describe the failure as likely, not certain.

Under `--json`, the envelope SHALL carry `pinnedCli`: an array of `{ location, name, spec }`, present on every successful run and empty when nothing is stale.

#### Scenario: A stale dependency and script pin are named and left alone

- **WHEN** `taskless init` runs at version `V` in a project whose `package.json` has `devDependencies["@taskless/cli"]` set to a version below `V`, and a script running `npx @taskless/cli@<older>`
- **THEN** stdout SHALL name both pins with their location and spec, and offer updating them to `V`
- **AND** `package.json` SHALL be byte-identical afterwards
- **AND** the notice SHALL appear after the upgrade trailer, with the onboarding trailer still the final line

#### Scenario: A pre-1.0 caret range that cannot reach the running version is stale

- **WHEN** `package.json` pins `@taskless/cli` at `^0.10.2` and the running CLI is `0.11.2`
- **THEN** the pin SHALL be reported

#### Scenario: A floating or current pin is not reported

- **WHEN** `package.json` pins `@taskless/cli` at `latest`, `*`, `>=0.10.0`, `workspace:*`, or a range that admits the running version, or a script runs `@taskless/cli@latest`
- **THEN** no pin SHALL be reported

#### Scenario: A migration makes the breakage definite

- **WHEN** `taskless init` migrates `.taskless/` to schema version `N` in a project with a stale pin
- **THEN** the notice SHALL name schema version `N` and `SCAFFOLD_VERSION_MISMATCH`
- **AND** SHALL state that CI running the pins will break, and that the bump belongs in the same commit as `.taskless/`
- **AND** SHALL NOT describe the failure as merely likely

#### Scenario: A stale pin is named on a re-install that changed nothing

- **WHEN** `taskless init` runs against a project that is already current and whose `package.json` holds a stale pin
- **THEN** stdout SHALL NOT contain the upgrade trailer
- **AND** stdout SHALL name the stale pin

#### Scenario: The JSON envelope carries the pins

- **WHEN** `taskless init --json` runs
- **THEN** the envelope SHALL contain `pinnedCli`, an array with one `{ location, name, spec }` entry per stale pin
- **AND** `pinnedCli` SHALL be an empty array when there is no `package.json` or nothing in it is stale
