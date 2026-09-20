## MODIFIED Requirements

### Requirement: Detect scans deterministic repo signals only

The `detect` command SHALL emit only deterministic signals derived from files on
disk: configured linters, detected languages, and the styles of the repo's own
existing rules. It SHALL NOT perform any LLM inference and SHALL NOT match the
request against any catalog of known packaged linter rules.

Detection follows a languages → linters flow: languages are inferred first, and
a linter's dependency evidence is then read from the manifest of that linter's
own language (a node dependency from `package.json`, a Python dependency from
`pyproject.toml`/`requirements.txt`) rather than conflating ecosystems. A
recognized linter config file on disk is honored regardless of the languages
inferred.

#### Scenario: Linter configs are detected from disk

- **WHEN** the working directory contains a recognized linter config (for
  example `.eslintrc*`, `eslint.config.js`, `ruff.toml`, a `[tool.ruff]` block in
  `pyproject.toml`, `.rubocop.yml`, `biome.json`, `.oxlintrc.json`, or
  `stylelint` config)
- **THEN** `detect --json` SHALL report each configured linter it found

#### Scenario: Languages are reported

- **WHEN** `detect --json` runs in a repository
- **THEN** the output SHALL include the languages inferred from manifest and
  marker files present on disk and from the linters detected

#### Scenario: A linter dependency is sourced from its own language's manifest

- **WHEN** a dependency-evidenced linter (for example `ruff`) is named only in a
  manifest belonging to a different language (for example `package.json`)
- **THEN** `detect --json` SHALL NOT report that linter from the mismatched
  manifest

#### Scenario: oxlint is detected from its config or its dependency

- **WHEN** the working directory contains one of the config files oxlint
  discovers on its own (`.oxlintrc.json`, `.oxlintrc.jsonc`, `oxlint.config.ts`,
  `oxlint.config.mts`), or names `oxlint` as a dependency in `package.json`
- **THEN** `detect --json` SHALL report `oxlint` as a JavaScript/TypeScript linter
- **AND** a repository configured only for eslint SHALL NOT report `oxlint`

#### Scenario: Configs in monorepo sub-packages are detected

- **WHEN** a linter config or language manifest lives in a sub-package rather
  than the repository root (for example `packages/api/.eslintrc.json`)
- **THEN** `detect --json` SHALL detect it and SHALL carry the path it was found
  at in the linter's evidence
- **AND** the scan SHALL prune a curated set of ignored directories (for example
  `node_modules`, `.git`, build output) and SHALL bound traversal depth

#### Scenario: The repo's own rule styles are surfaced

- **WHEN** the working directory contains existing rule definitions (for example
  custom linter rules or `.taskless/rules/`)
- **THEN** `detect --json` SHALL surface a description of those existing rule
  styles for downstream authoring

#### Scenario: No packaged-rule catalog matching

- **WHEN** `detect --json` runs
- **THEN** the output SHALL NOT claim a request maps to a specific named packaged
  rule (such matching is left to the authoring recipe, not the command)
