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
disk: configured linters, detected languages, the styles of the repo's own
existing rules, the CI systems configured for the repository, the tools that
run commands at commit time, and the command-line tools present on the host's
`PATH`. It SHALL NOT perform any LLM inference and SHALL NOT match the
request against any catalog of known packaged linter rules.

Detection follows a languages → linters flow: languages are inferred first, and
a linter's dependency evidence is then read from the manifest of that linter's
own language (a node dependency from `package.json`, a Python dependency from
`pyproject.toml`/`requirements.txt`) rather than conflating ecosystems. A
recognized linter config file on disk is honored regardless of the languages
inferred.

ast-grep and Vale are linters for this purpose. Anything under `.taskless/` is
Taskless's own configuration, not the repository's, and SHALL NOT be evidence
for any linter.

CI systems and commit-hook tools are matched at the scan root only, never in a
sub-package. A CI system reads its configuration from the repository root and git
runs one set of hooks per repository, so a match further down the tree is a
fixture or a vendored project rather than this repository's configuration. Each
is reported as a `name` with the `evidence` that matched, in the same shape as a
linter.

Host tools (`gh`, `git`, `jq`, `glab`) SHALL be established by looking for a file
of that name on `PATH`, and SHALL NOT be established by executing anything. Each
SHALL be reported as present or absent, and as applicable or not where the
tool's usefulness depends on the repository: `gh` is applicable only when
`origin` is a GitHub remote, and `glab` only when `origin` is a GitLab remote
(`gitlab.com`, or a host whose name begins with `gitlab.`). An inapplicable tool
SHALL carry the reason.

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

#### Scenario: CI systems are detected from their root config

- **WHEN** the scan root contains a recognized CI configuration (for example
  `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/config.yml`,
  `Jenkinsfile`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`,
  `.buildkite/`, `.drone.yml`, or `.travis.yml`)
- **THEN** `detect --json` SHALL report each such CI system under `ci`, with the
  matching paths as its evidence

#### Scenario: A CI config below the root is not this repository's CI

- **WHEN** a CI configuration file exists only in a sub-directory (for example
  `packages/api/.gitlab-ci.yml`)
- **THEN** `detect --json` SHALL NOT report that CI system

#### Scenario: Commit-hook tools are detected from config or root dependency

- **WHEN** the scan root contains a recognized hook tool's configuration (for
  example a `.husky/` directory, `lefthook.yml`, `.pre-commit-config.yaml`, a
  `simple-git-hooks` or `lint-staged` config file, or a `simple-git-hooks` or
  `lint-staged` key in the root `package.json`), or the root `package.json`
  names the tool as a dependency
- **THEN** `detect --json` SHALL report the tool under `hooks`, with what matched
  as its evidence

#### Scenario: No CI and no hooks are reported as empty lists

- **WHEN** the scan root carries no recognized CI configuration and no
  recognized hook tool
- **THEN** `detect --json` SHALL report `ci` and `hooks` as empty arrays rather
  than omitting them

#### Scenario: ast-grep is detected from its config

- **WHEN** the working directory contains `sgconfig.yml` or `.sgconfig.yml`
  outside `.taskless/`
- **THEN** `detect --json` SHALL report `ast-grep` as a linter with that path as
  its evidence

#### Scenario: Vale is detected from its config

- **WHEN** the working directory contains `.vale.ini` or `_vale.ini` outside
  `.taskless/`
- **THEN** `detect --json` SHALL report `vale` as a linter with that path as its
  evidence

#### Scenario: Taskless's own configuration is not the repository's

- **WHEN** the only `sgconfig.yml` or `.vale.ini` in the working directory is
  under `.taskless/`
- **THEN** `detect --json` SHALL NOT report `ast-grep` or `vale`

#### Scenario: Host tools are reported by presence

- **WHEN** `gh` is on `PATH` and `glab` is not, in a repository whose `origin`
  is a GitHub remote
- **THEN** `detect --json` SHALL report `gh` as present and applicable
- **AND** SHALL report `glab` as absent
- **AND** SHALL NOT have executed either

#### Scenario: A host tool for the other forge is inapplicable

- **WHEN** `glab` is on `PATH` in a repository whose `origin` is a GitHub remote
- **THEN** `detect --json` SHALL report `glab` as present and not applicable,
  with the reason that the repository has no GitLab origin

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

The object SHALL carry `hostTools`, one entry per host tool with its `name`,
`present`, `applicable`, the `path` it was found at when present, and the
`reason` when not applicable. It SHALL carry `agent`, an object whose keys are
commands the agent may choose to run and whose values say in one sentence what
each tells it. `agent` SHALL hold an entry only for a tool that is present and
applicable, and an entry SHALL state any way the command's result is
misleading (for example an exit code that does not reflect sign-in state).
The hints and the onboard recipe's host-tool text SHALL be drawn from one
source, so the two cannot describe a tool differently.

#### Scenario: JSON output validates against the internal schema

- **WHEN** `detect --json` succeeds
- **THEN** stdout SHALL be a single JSON object that the command has validated
  against its internal output schema (linters, languages, existing rule styles,
  CI systems, commit-hook tools, host tools, agent hints)

#### Scenario: A usable tool carries a hint

- **WHEN** `gh` is present and applicable
- **THEN** `agent` SHALL contain a `gh auth status` key whose value says it
  verifies whether the user is signed in and GitHub can be used as a source

#### Scenario: An unusable tool carries no hint

- **WHEN** `glab` is absent, or present but not applicable
- **THEN** `agent` SHALL NOT contain a `glab` command

#### Scenario: A misleading exit code is called out

- **WHEN** `glab` is present and applicable
- **THEN** its `agent` entry SHALL state that the output, not the exit code,
  shows whether the user is signed in

### Requirement: Detect recognizes a linter its ecosystem installs or runs by default

`detect` SHALL report a linter that a repository installs as a dependency, configures inside a manifest, or runs from its CI or commit-hook configuration, even when the linter has no dedicated config file. A dependency SHALL be read from the manifests of the linter's own languages: `package.json` for JavaScript and TypeScript; `pyproject.toml` and every pip requirements file for Python; `Gemfile` for Ruby; `composer.json` `require` and `require-dev` for PHP; `go.mod` `require` and `tool` directives for Go, matched by module-path prefix; and `Package.swift` package URLs for Swift.

A CI or commit-hook configuration SHALL be read only from the root-level files that `ci` and `hooks` are detected from, and SHALL be evidence only when one of its commands runs the linter: a command field of a YAML, JSON, or TOML config, or a non-comment line of a script. A comment or a label such as a step's `name` SHALL NOT be evidence. Each match SHALL be reported as the file path followed by the matched command.

A linter that ships with a language toolchain rather than being declared as a dependency, such as clippy, SHALL NOT be reported merely because that language is present.

#### Scenario: clippy configured in Cargo.toml

- **WHEN** a `Cargo.toml` declares `[lints.clippy]` or `[workspace.lints.clippy]`
- **THEN** `detect --json` SHALL report `clippy` with evidence naming that manifest and table

#### Scenario: clippy run from CI

- **WHEN** a root GitHub Actions workflow runs `cargo clippy`, with or without a `+toolchain` argument
- **THEN** `detect --json` SHALL report `clippy` with evidence naming the workflow file and the command

#### Scenario: A Rust repository that never configures or runs clippy

- **WHEN** a repository has a `Cargo.toml` and nothing configures or runs clippy
- **THEN** `detect --json` SHALL report `Rust` among `languages` and SHALL NOT report `clippy`

#### Scenario: A linter declared as a dependency in its ecosystem's manifest

- **WHEN** `rubocop` is a gem in a `Gemfile`, `phpstan/phpstan` is in `composer.json` `require-dev`, `github.com/golangci/golangci-lint/v2/cmd/golangci-lint` is a `go.mod` `tool`, or `ruff` is listed in `requirements-dev.txt`
- **THEN** `detect --json` SHALL report that linter with a dependency marker naming the manifest

#### Scenario: Config inside a shared file

- **WHEN** `setup.cfg` or `tox.ini` has a `[flake8]` section, or `package.json` has a top-level `prettier` or `stylelint` key
- **THEN** `detect --json` SHALL report that linter with evidence naming the file and the section or key

#### Scenario: A linter run from a pre-commit hook

- **WHEN** a root `.pre-commit-config.yaml` uses `astral-sh/ruff-pre-commit`
- **THEN** `detect --json` SHALL report `ruff` with evidence naming `.pre-commit-config.yaml`

#### Scenario: A CI config below the root is not evidence

- **WHEN** the only command that runs a linter is in a CI config inside a sub-directory
- **THEN** `detect --json` SHALL NOT report that linter from it

#### Scenario: A mention that is not a command is not evidence

- **WHEN** a root CI or hook config names a linter only in a comment, a step's `name`, or another field that is not a command
- **THEN** `detect --json` SHALL NOT report that linter from it

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
