## MODIFIED Requirements

### Requirement: First migration creates initial directory structure

The first migration (`"1"` in `filesystem/migrations/0001-init.ts`) SHALL create the initial `.taskless/` directory structure: `README.md` with usage documentation (always overwritten), `.gitignore` entries via `addToGitignore(cwd, [".env.local.json", "sgconfig.yml"])`, `rules/` directory, and `rule-tests/` directory.

The README's usage examples SHALL name the package specifier the running build is actually reachable by, not the released one. A nightly that writes a README directing its reader to `@taskless/cli` sends them to install the release over the build they installed to exercise unreleased behavior.

The specifier and the launcher are separate halves of that answer and SHALL be treated separately. The specifier is a build-time fact and SHALL be applied to every launcher the README lists, so that no build emits a README that is correct on one line and wrong on the next. The launcher is a runtime fact and SHALL NOT be resolved by detection here: the file is written once, read much later by someone who may use either package manager, overwritten on every migration run, and commonly committed, so its bytes SHALL NOT depend on how a particular run was launched.

A build whose invocation is a filesystem path rather than a package SHALL emit that one invocation instead of a launcher menu, since no launcher fronts a path.

#### Scenario: README content

- **WHEN** migration `"1"` runs
- **THEN** `.taskless/README.md` SHALL be written (overwriting any existing content) with a link to taskless.io, usage examples showing `pnpm dlx` and `npx` invocations of `check`, and a file listing describing `taskless.json`, `.env.local.json`, `rules/`, and `rule-tests/`

#### Scenario: A released build names the released package

- **WHEN** migration `"1"` runs in a `prod` build
- **THEN** both usage examples SHALL name `@taskless/cli@latest`

#### Scenario: A nightly names itself on every launcher it lists

- **WHEN** migration `"1"` runs in a `nightly` build
- **THEN** both the `pnpm dlx` and the `npx` example SHALL name `@taskless/cli-nightly` at the nightly's own version
- **AND** the README SHALL NOT name the released package anywhere

#### Scenario: A path-form build lists no launcher

- **WHEN** migration `"1"` runs in a build whose invocation is a filesystem path
- **THEN** the usage example SHALL be that invocation alone
- **AND** SHALL NOT offer a package-manager choice

#### Scenario: README bytes do not depend on how the CLI was launched

- **WHEN** the same build runs migration `"1"` from two different launchers
- **THEN** the two READMEs SHALL be identical

#### Scenario: Gitignore is created

- **WHEN** migration `"1"` runs
- **THEN** `.taskless/.gitignore` SHALL contain entries for `.env.local.json` and `sgconfig.yml`

#### Scenario: Subdirectories are created

- **WHEN** migration `"1"` runs
- **THEN** `.taskless/rules/` and `.taskless/rule-tests/` SHALL exist
