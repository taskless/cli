## ADDED Requirements

### Requirement: Detect counts the repository's own rules per linter

`detect --json` SHALL report, for each detected linter that can host custom rules, how many custom rules the repository itself authors for it, and the evidence for that count. A custom rule is one whose logic the repository wrote:

- ESLint: rules in a local plugin or rule directory, including plugins defined inline in the config or imported from a file in the repository.
- Biome: entries in the configuration's `plugins` list.
- pylint: modules named by `load-plugins` that live in the repository.
- flake8: checkers registered under `[flake8:local-plugins]`, or a `flake8.extension` entry point the repository publishes.

Optional extensions shipped with the tool, third-party plugin packages, presets, and rule selection SHALL NOT count. Ruff has no custom-rule mechanism and SHALL report a count of zero. The count SHALL be derived from files on disk without executing anything, consistent with detect's other signals.

#### Scenario: Local ESLint rules are counted

- **WHEN** the repository has a local ESLint plugin defining six rules
- **THEN** `detect --json` SHALL report a custom-rule count of six for ESLint with the plugin's path as evidence

#### Scenario: A built-in pylint extension does not count

- **WHEN** `load-plugins` names only `pylint.extensions.*` modules
- **THEN** `detect --json` SHALL report a custom-rule count of zero for pylint

#### Scenario: Ruff reports no custom rules

- **WHEN** the repository configures Ruff, however extensively
- **THEN** `detect --json` SHALL report a custom-rule count of zero for Ruff
