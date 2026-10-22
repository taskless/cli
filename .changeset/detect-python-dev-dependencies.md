---
"@taskless/cli": patch
---

`taskless detect` now finds a linter the way its ecosystem usually installs or runs it, not only from a dedicated config file, so a repository that lints on a tool's defaults no longer reads as having no linter.

- **Dependencies** are read from every ecosystem's manifest: `pyproject.toml` dev dependencies (PEP 735 `[dependency-groups]`, which `uv add --dev` writes, `[tool.uv] dev-dependencies`, `[tool.pdm.dev-dependencies]`, Hatch environments, and Poetry groups, which were previously read by group name), every pip requirements file such as `requirements-dev.txt` or `requirements/*.txt`, `Gemfile` gems, `composer.json` `require-dev`, `go.mod` `tool` directives, and `Package.swift` packages.
- **Config inside a manifest**: `[lints.clippy]` in `Cargo.toml`, a `[flake8]` section in `setup.cfg` or `tox.ini`, and the `prettier` and `stylelint` keys in `package.json`.
- **A root CI or hook config that runs the linter**, such as a workflow running `cargo clippy` or a pre-commit hook from `astral-sh/ruff-pre-commit`. Being a Rust repository is not on its own evidence of clippy.
- **New linters**: `standard`, `pint`, and `php-cs-fixer`. ESLint, Prettier, and stylelint gain their TypeScript and other missing config filenames.
