# CLI Taskless Bootstrap

## Purpose

Defines the migration-based `.taskless/` directory management system, including the filesystem utilities, migration runner, and initial migration.

## Requirements

### Requirement: Migration-based .taskless directory management

The CLI SHALL provide an `ensureTasklessDirectory(cwd)` function in `filesystem/directory.ts` that creates the `.taskless/` directory and delegates to `runMigrations()` in `filesystem/migrate.ts`. Migrations SHALL be defined as a `Record<string, Migration>` where each migration is an idempotent async function with signature `(directory: string) => Promise<void>`.

#### Scenario: First run bootstraps directory via migrations

- **WHEN** an action calls `ensureTasklessDirectory()` and `.taskless/` does not exist
- **THEN** it SHALL create `.taskless/taskless.json` with `{ "version": 0 }`
- **AND** run all registered migrations in order
- **AND** update `taskless.json` version to the max migration key

#### Scenario: Up-to-date directory is a no-op

- **WHEN** `ensureTasklessDirectory()` is called and `taskless.json` version equals the max migration key
- **THEN** it SHALL return immediately without running any migrations

#### Scenario: Outdated directory runs only new migrations

- **WHEN** `taskless.json` has `{ "version": 1 }` and migrations `"1"`, `"2"`, `"3"` are registered
- **THEN** `ensureTasklessDirectory()` SHALL run migrations 2 and 3 (skipping migration 1)
- **AND** update `taskless.json` version to 3

#### Scenario: Non-numeric version is treated as 0

- **WHEN** `taskless.json` has a non-numeric version (e.g., `"2026-03-02"` from v0 scaffold)
- **THEN** the migration runner SHALL treat it as version 0 and run all migrations

#### Scenario: Each migration is idempotent

- **WHEN** a migration runs against a directory where its changes already exist
- **THEN** it SHALL complete without errors and without duplicating files or content

### Requirement: Migrations are keyed numerically and sorted at runtime

Migrations SHALL be stored as a `Record<string, Migration>` with numeric string keys (e.g., `"1"`, `"2"`, `"3"`). Keys are cast to `Number` and sorted numerically at runtime via `toSorted()`. Older migrations MAY be removed once the minimum supported version advances.

#### Scenario: Migrations are sorted numerically

- **WHEN** the migration runner processes the registry
- **THEN** migrations SHALL be sorted by their numeric key value, not by insertion order

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

### Requirement: Filesystem utilities are generic

The `filesystem/` module SHALL provide generic utilities that migrations compose:

- `addToGitignore(cwd, globs)`: Idempotently adds glob patterns to `.taskless/.gitignore`
- `generateSgConfig(cwd)`: Writes ephemeral `sgconfig.yml` with `ruleDirs` and `testConfigs`

These utilities SHALL NOT hardcode Taskless-specific entries — the migrations decide what to pass.

#### Scenario: addToGitignore is idempotent

- **WHEN** `addToGitignore(cwd, [".env.local.json"])` is called twice
- **THEN** `.env.local.json` SHALL appear exactly once in `.taskless/.gitignore`

### Requirement: Bootstrap is called from all write paths

The `ensureTasklessDirectory()` function SHALL be called from: `writeRuleFile()`, `writeRuleTestFile()`, `generateSgConfig()`, and the `rule verify` command. This ensures `.taskless/` is always properly initialized and up-to-date before any file writes.

#### Scenario: Rule file write triggers bootstrap

- **WHEN** `writeRuleFile()` is called and `.taskless/` does not exist
- **THEN** `ensureTasklessDirectory()` SHALL run before writing the rule file

#### Scenario: Verify command triggers bootstrap

- **WHEN** `taskless rule verify` runs and needs to generate `sgconfig.yml`
- **THEN** `ensureTasklessDirectory()` SHALL run as part of the `generateSgConfig()` call

### Requirement: Migration 2 initializes an empty install object

Migration `"2"` SHALL be registered in the migration runner. Its behavior is idempotent: if `taskless.json` does not yet contain an `install` field, migration 2 SHALL add `install: {}` as a top-level object. If the field is already present, migration 2 SHALL leave it untouched. After migration 2 runs, `taskless.json` version SHALL be updated to `2` by the migration runner's existing finalization logic.

#### Scenario: Fresh project has install object after bootstrap

- **WHEN** `ensureTasklessDirectory()` is called in a project without a prior `.taskless/` directory
- **THEN** `taskless.json` SHALL be created with `{ "version": 2, "install": {} }`

#### Scenario: Existing v1 project is forward-migrated

- **WHEN** `ensureTasklessDirectory()` is called in a project whose existing `taskless.json` is at version `1`
- **THEN** the migration runner SHALL invoke migration 2
- **AND** `taskless.json` SHALL contain `install: {}`
- **AND** `taskless.json` version SHALL be `2`

#### Scenario: Migration 2 preserves existing install object

- **WHEN** `ensureTasklessDirectory()` is called in a project whose `taskless.json` already contains an `install` object (e.g., from a prior run of migration 2 that partially completed)
- **THEN** migration 2 SHALL NOT overwrite the existing `install` object

### Requirement: Install manifest schema is a recognized top-level field

The `TasklessManifest` type in `packages/cli/src/filesystem/migrate.ts` SHALL be extended to include an optional `install` field with the following shape:

```ts
interface TasklessManifest {
  version: number;
  install?: {
    installedAt?: string;
    cliVersion?: string;
    targets?: Record<
      string,
      {
        skills?: string[];
        commands?: string[];
      }
    >;
    onboarded?: boolean;
  };
}
```

The `install.onboarded` field is optional and three-state: absent (never explicitly onboarded), `false` (explicitly reset), or `true` (user confirmed onboarding is complete). The `taskless init` install path SHALL NOT set this field. The field SHALL only be written by the `taskless onboard --mark-complete` subcommand, which is invoked by the host agent only after explicit user confirmation. Reads of `taskless.json` SHALL preserve unknown fields on round-trip writes so the manifest remains forward-compatible with future migrations.

#### Scenario: Install field round-trips through read/write

- **WHEN** `taskless.json` contains an `install` object
- **AND** the CLI reads the manifest and writes it back
- **THEN** the `install` object SHALL be preserved verbatim

#### Scenario: Unknown fields are preserved on write

- **WHEN** `taskless.json` contains an unknown top-level field (e.g., `experimental: {...}`)
- **AND** the CLI writes the manifest after a version bump
- **THEN** the unknown field SHALL still be present in the output

#### Scenario: Onboarded field round-trips through read/write

- **WHEN** `taskless.json` contains `install.onboarded: true`
- **AND** the CLI reads the manifest and writes it back (e.g., as part of a re-install)
- **THEN** the `install.onboarded: true` value SHALL be preserved

#### Scenario: Init does not set onboarded

- **WHEN** `taskless init` runs against a project with no prior `install.onboarded` value
- **THEN** the resulting `taskless.json` SHALL NOT contain an `install.onboarded` field

### Requirement: Onboarded field semantics are 3-state and consent-gated

The optional `install.onboarded` boolean field on the install manifest SHALL be interpreted by all readers as three meaningful states:

| Value   | Meaning                                                               |
| ------- | --------------------------------------------------------------------- |
| absent  | Never explicitly onboarded (the post-install default)                 |
| `false` | Explicitly reset (treated equivalently to absent for gating purposes) |
| `true`  | User confirmed onboarding is complete                                 |

The field SHALL only be written by the `taskless onboard --mark-complete` subcommand. No other CLI code path (including `taskless init`, the wizard, and any future migration) SHALL write or set this field automatically. The field MAY be edited manually by an advanced user; such edits are out of scope for the CLI's guarantees.

#### Scenario: Absent and false both gate as "not onboarded"

- **WHEN** any consumer of the manifest reads `install.onboarded`
- **AND** the field is absent OR `false`
- **THEN** the consumer SHALL treat the user as not yet onboarded for any gating purpose

#### Scenario: True gates as "onboarded"

- **WHEN** any consumer of the manifest reads `install.onboarded`
- **AND** the field is `true`
- **THEN** the consumer SHALL treat the user as onboarded

#### Scenario: No CLI path writes onboarded except mark-complete

- **WHEN** the codebase is searched for writes to `install.onboarded`
- **THEN** the only producer SHALL be the `taskless onboard --mark-complete` subcommand

### Requirement: Migration 7 ignores scratch request files

Migration `7` SHALL add `/.tmp-*` to `.taskless/.gitignore` through the shared gitignore helper, so that the scratch request files agent recipes write under `.taskless/` (for example `.tmp-rule-request.json`, `.tmp-improve-request.json`, `.tmp-feedback.json`) are never committed. It SHALL NOT modify migration `1` or any other shipped migration; a fresh scaffold reaches the same `.gitignore` by running migrations `1` through `7` in order.

#### Scenario: An existing scaffold gains the ignore line

- **WHEN** `taskless.json` records version 6 and the CLI bootstraps `.taskless/`
- **THEN** migration 7 SHALL run
- **AND** `.taskless/.gitignore` SHALL contain a `/.tmp-*` line
- **AND** `taskless.json` SHALL record version 7

#### Scenario: A fresh scaffold ends with the same file

- **WHEN** `.taskless/` does not exist and the CLI bootstraps it
- **THEN** `.taskless/.gitignore` SHALL contain `.env.local.json`, `/sgconfig.yml`, and `/.tmp-*`
- **AND** migration 1's own source SHALL be unchanged from the previous release

#### Scenario: Migration 7 is idempotent

- **WHEN** `.taskless/.gitignore` already contains `/.tmp-*` and migration 7 runs
- **THEN** the file SHALL contain exactly one `/.tmp-*` line afterwards

### Requirement: Migration 8 drops BasedOnStyles from Vale rule configs

Migration `8` SHALL delete every `BasedOnStyles` assignment line from each `.taskless/rules/vale/<id>/.vale.ini`, whatever the value, and SHALL change nothing else in the file: every other line, comment, blank line and line ending SHALL be preserved byte for byte, and a comment that mentions `BasedOnStyles` SHALL be left alone. A config without the line SHALL NOT be rewritten. A project with no `rules/vale/` tree SHALL be left as it is. It SHALL NOT modify any shipped migration.

The migration exists because the `create-vale-rule` recipe wrote `BasedOnStyles =` into every matcher through the release before this one, the config schema now rejects the key, and `check` and `verify` refuse to run on a scaffold behind the current version. Without the rewrite every upgraded project's first `check` would refuse the Vale engine over a line the CLI itself wrote.

#### Scenario: An existing scaffold loses the line from every matcher

- **WHEN** `taskless.json` records version 7, a rule's `.vale.ini` carries `BasedOnStyles =` in three matchers, and the CLI bootstraps `.taskless/`
- **THEN** migration 8 SHALL run
- **AND** the config SHALL contain no `BasedOnStyles` line and every other byte unchanged
- **AND** the rewritten config SHALL pass the config schema
- **AND** `taskless.json` SHALL record the latest schema version

#### Scenario: A config without the line is untouched

- **WHEN** a rule's `.vale.ini` carries no `BasedOnStyles` line and migration 8 runs
- **THEN** the file SHALL NOT be written

#### Scenario: A comment naming the key survives

- **WHEN** a rule's `.vale.ini` carries a comment line that mentions `BasedOnStyles` and migration 8 runs
- **THEN** the comment SHALL remain and only assignment lines SHALL be removed

#### Scenario: Migration 8 is idempotent

- **WHEN** migration 8 runs twice over the same scaffold
- **THEN** the second run SHALL change nothing

### Requirement: Migration 9 renames a rule id held by more than one engine

Migration `9` SHALL read `.taskless/rules/` and, for every rule id that is a directory name under more than one engine, SHALL rename EVERY holding copy to `<id>-<engine>`. No engine SHALL keep the bare id. Any precedence rule would be arbitrary, and a symmetric rename means no user has to work out which of their two rules silently kept the name.

It SHALL rename rather than refuse. A throwing migration walls `init`, which is the command `SCAFFOLD_MIGRATION_REQUIRED` sends a stale scaffold to, so a refusal leaves the CLI's own instruction failing and a multi-file hand edit as the only way out.

The rename SHALL carry every reference to the id inside the rule's own directory, and SHALL reach nothing outside it:

| Engine    | What the rename SHALL move                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| `sg`      | the directory, `<id>.yml`, its `id:` field, every `.tests/<id>-*-test.yml`, and each fixture's own `id:` field  |
| `vale`    | the directory, `<id>.yml`, and in `.vale.ini` both the `tskl) rule` breadcrumb and both segments of `<id>.<id>` |
| `runtime` | the directory only                                                                                              |

Both Vale segments move because `StylesPath` points at `rules/vale`, so the rule directory is the style and `<id>.yml` is the check inside it. A runtime rule carries the id in its directory alone: `check.ts` is a fixed name, and a capture file's `id:` and `metadata.taskless.name` identify the capture rather than the rule.

It SHALL NOT clobber. When `<id>-<engine>` is already in use the migration SHALL take the first free `<id>-<engine>-N` counting from 2, and a name SHALL count as free only when NO engine holds it, so resolving one collision cannot create another. Every name it chooses SHALL satisfy the rule id contract.

It SHALL NOT move or delete `.taskless/rule-metadata/<id>.yml`. The rename is symmetric, so the sidecar has no owner to follow and moving it to either side would be a guess.

It SHALL print every rename: the old path, the new path, and each file rewritten inside it. A migration that silently renames a user's rules is worse than one that refuses.

It SHALL write nothing when there is no collision. A project in that state SHALL be read and left exactly as it is, so a second run touches nothing and the working tree stays clean. A project with no `rules/` tree SHALL be left as it is.

#### Scenario: Every colliding copy is renamed symmetrically

- **WHEN** `no-eval` exists under both `sg` and `vale` and migration 9 runs
- **THEN** `rules/sg/no-eval` SHALL become `rules/sg/no-eval-sg`
- **AND** `rules/vale/no-eval` SHALL become `rules/vale/no-eval-vale`
- **AND** no engine SHALL still hold the bare id

#### Scenario: An sg rule's file, id field and fixtures follow it

- **WHEN** migration 9 renames a colliding `sg` rule
- **THEN** `<old>.yml` SHALL become `<new>.yml` with its `id:` field rewritten
- **AND** every `.tests/<old>-*-test.yml` SHALL be renamed to the new prefix with its own `id:` field rewritten

#### Scenario: A Vale rule's style file and both config segments follow it

- **WHEN** migration 9 renames a colliding `vale` rule
- **THEN** `<old>.yml` SHALL become `<new>.yml`
- **AND** the `.vale.ini` breadcrumb SHALL name the new id
- **AND** the `<old>.<old>` assignment SHALL become `<new>.<new>`

#### Scenario: A runtime rule is renamed by directory alone

- **WHEN** migration 9 renames a colliding `runtime` rule
- **THEN** the directory SHALL be renamed
- **AND** `check.ts` and the capture files SHALL be left as they are

#### Scenario: A taken target name takes the next free suffix

- **WHEN** `<id>-<engine>` is already held by some engine
- **THEN** the migration SHALL rename to the first free `<id>-<engine>-N` counting from 2
- **AND** the existing rule of that name SHALL NOT be modified

#### Scenario: The metadata sidecar is left in place

- **WHEN** `.taskless/rule-metadata/<id>.yml` exists for a colliding id and migration 9 runs
- **THEN** the sidecar SHALL be left exactly as it is
- **AND** the report SHALL say it was left behind

#### Scenario: Every rename is reported

- **WHEN** migration 9 renames anything
- **THEN** it SHALL print each old path, each new path, and each file it rewrote

#### Scenario: The renamed project verifies and checks clean

- **WHEN** migration 9 has renamed a colliding project
- **THEN** `verify` SHALL report no collision
- **AND** each renamed rule SHALL still run and report findings under its new id

#### Scenario: Migration 9 is idempotent

- **WHEN** migration 9 runs a second time over a project it has already renamed, or over one with no collision
- **THEN** it SHALL write nothing

#### Scenario: A project with no rules tree is left alone

- **WHEN** `.taskless/rules/` does not exist and migration 9 runs
- **THEN** the migration SHALL succeed and write nothing
