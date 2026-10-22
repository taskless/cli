## Why

`taskless detect` recognised a linter mostly by its dedicated config file. Most ecosystems install a linter as a dependency and run it on its defaults, or keep its config inside a manifest, so a repository could run a linter and still read as having none. Fifteen fixtures modelled on each ecosystem's common setup all came back with no linters: clippy configured in `Cargo.toml` or run in CI, rubocop or standard as a gem, phpstan, phpcs or pint as a Composer dev dependency, golangci-lint as a Go `tool`, SwiftLint as a SwiftPM plugin, flake8 configured in `setup.cfg` or `tox.ini`, ruff in a `requirements-dev.txt` or a pre-commit hook, and prettier or stylelint configured in `package.json`. #574 fixed the same problem for `pyproject.toml` dev dependencies; this change covers the rest.

## What Changes

- **Every ecosystem's dependency manifest is read.** `Gemfile` gems for Ruby, `composer.json` `require` and `require-dev` for PHP, `go.mod` `require` and `tool` directives for Go (matched by module-path prefix, so `/v2/cmd/...` counts), and `Package.swift` package URLs for Swift. Python reads every pip requirements file (`requirements-dev.txt`, `dev-requirements.txt`, `requirements/*.txt`, and the `.in` sources pip-tools compiles), not only `requirements.txt`.
- **Config inside a manifest counts.** `[lints.clippy]` and `[workspace.lints.clippy]` in `Cargo.toml`, a `[flake8]` section in `setup.cfg` or `tox.ini`, and the `prettier` and `stylelint` keys in `package.json`, alongside the existing `[tool.*]` tables and `eslintConfig`.
- **A root CI or hook config that runs a linter is evidence**, read from the same root-only files `ci` and `hooks` report. Only commands count: the command fields of a YAML, JSON, or TOML config (`run`, `script`, `entry`, `uses`, `repo`, and the like) and the non-comment lines of a script, never a comment or a step's `name`. Evidence looks like `.github/workflows/ci.yml (cargo clippy)` or `.pre-commit-config.yaml (astral-sh/ruff-pre-commit)`. This is the only evidence for clippy run on its defaults, since clippy ships with the toolchain and is never a dependency. Being a Rust repository is not by itself evidence of clippy.
- **New linters**: `standard` (Ruby), `pint` and `php-cs-fixer` (PHP).
- **Missing config filenames**: `eslint.config.{mts,cts}`; prettier's `.prettierrc.{mjs,json5,toml,ts,mts,cts}` and `prettier.config.{ts,mts,cts}`; stylelint's `.stylelintrc.{mjs,ts}` and `stylelint.config.ts`. Each list was checked against the tool's own source (ESLint 9.39, Prettier 3.8.1, stylelint 17.16 via cosmiconfig 9).
- **Recipe**: `detect` (v4) describes the new evidence kinds.

The JSON shape is unchanged: these are new `evidence` strings and new `name` values.

## Capabilities

### Modified Capabilities

- `cli-detect`: adds "Detect recognizes a linter its ecosystem installs or runs by default". The existing requirements are unchanged.

## Delivery Shape

**Stacked, merging forward**, on #574. Each PR only adds evidence `detect` reports, so either one is safe on `main` by itself. This is the tip, so it archives the change.
