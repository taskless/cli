# cli-detect Specification

## Purpose

The `taskless detect` subcommand: an offline, deterministic read of a repository's signals, emitted as a stable JSON shape that other commands and agents branch on.

## Requirements

### Requirement: Detect subcommand exists

The CLI SHALL provide a `taskless detect` subcommand registered in the top-level
command list, with a `--json` flag and the standard `--dir`/`-d` working-directory
flag.

#### Scenario: Detect is registered

- **WHEN** `taskless detect --help` is run
- **THEN** the command SHALL be recognized and print its usage
- **AND** the command SHALL accept `--json` and `--dir`/`-d`

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
  `pyproject.toml`, `.rubocop.yml`, `biome.json`, or `stylelint` config)
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

### Requirement: Detect runs offline with no network or auth

The `detect` command SHALL complete without network access and without
authentication.

#### Scenario: Detect works without login or network

- **WHEN** `detect --json` runs while logged out and offline
- **THEN** it SHALL produce its signal output successfully
- **AND** it SHALL NOT require or prompt for authentication

### Requirement: Detect emits a stable JSON shape

When `--json` is set, `detect` SHALL emit a single structured JSON object whose
shape is validated internally against a stable Zod output schema before being
printed, consistent with how other `--json` commands in the CLI (e.g. `info`,
`check`) validate their output. The schema is an internal contract, not a
published artifact, and `detect` does not expose a `--schema` mode.

#### Scenario: JSON output validates against the internal schema

- **WHEN** `detect --json` succeeds
- **THEN** stdout SHALL be a single JSON object that the command has validated
  against its internal output schema (linters, languages, existing rule styles)
