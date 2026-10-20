## ADDED Requirements

### Requirement: The README lists the project launcher first

For a build that installs a launcher, `.taskless/README.md` SHALL list that package's launcher, `./.taskless/bin/cli.mjs` for the release and `./.taskless/bin/cli-nightly.mjs` for a nightly, as the first usage example, run from the repository root, above the `pnpm dlx` and `npx` examples. The package-manager examples SHALL remain, for a checkout where the launcher is not there yet. The launcher is chosen from the package the README's specifier names, so the bytes still do not depend on how the run was launched. A path-form build, which installs no launcher, SHALL list none.

#### Scenario: A released build lists cli.mjs first

- **WHEN** migration `"1"` runs in a `prod` build
- **THEN** the first usage example SHALL be `./.taskless/bin/cli.mjs check`
- **AND** the `pnpm dlx` and `npx` examples SHALL follow it

#### Scenario: A nightly lists its own launcher

- **WHEN** migration `"1"` runs in a `nightly` build
- **THEN** the first usage example SHALL be `./.taskless/bin/cli-nightly.mjs check`
- **AND** the README SHALL NOT name `./.taskless/bin/cli.mjs`
