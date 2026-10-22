## 1. Detection

- [x] 1.1 In `detect/scan.ts`, read dependencies from `Gemfile`, `composer.json`, `go.mod`, `Package.swift`, and every pip requirements file, keyed by the linter's languages.
- [x] 1.2 Generalize `pyprojectTables` to `manifestTables` (adding `Cargo.toml`), and add `iniSections`, `packageJsonKeys`, and `invocations` matched against the commands `automationCommands` extracts from the root `automationFiles`, never their comments or labels.
- [x] 1.3 Add `standard`, `pint`, and `php-cs-fixer`, and the missing ESLint, Prettier, and stylelint config filenames, checked against each tool's source.

## 2. Recipe and tests

- [x] 2.1 `detect` recipe (v4), the evidence description in `schemas/detect.ts`, and the `DetectedLinter` doc.
- [x] 2.2 Tests: one case per new evidence source, plus clippy not inferred from Rust alone and no invocation read below the root.
- [x] 2.3 `pnpm typecheck`, `pnpm lint`, and the detect tests pass.
