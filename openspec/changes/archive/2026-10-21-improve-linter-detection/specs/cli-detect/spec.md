## ADDED Requirements

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
