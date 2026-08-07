# Infrastructure

## Purpose

Defines build tooling, CI pipelines, and repository configuration including version sync, command generation, Turborepo setup, and GitHub Actions workflows.

## Build Tooling

### Requirement: tsx is available for build scripts

The root `package.json` SHALL declare `tsx` as a devDependency. All scripts in `scripts/` SHALL be TypeScript files executed via `tsx`.

#### Scenario: tsx is declared as a devDependency

- **WHEN** inspecting the root `package.json`
- **THEN** `tsx` SHALL be listed in `devDependencies`

#### Scenario: Scripts are executable with tsx

- **WHEN** running `tsx scripts/sync-skill-versions.ts`
- **THEN** the script SHALL execute without requiring additional configuration

### Requirement: Version sync script updates skill metadata

A `scripts/sync-skill-versions.ts` script SHALL read the version from `packages/cli/package.json` and update the `metadata.version` field in all `SKILL.md` files under `skills/`. The script SHALL be idempotent — if versions already match, no files SHALL be modified.

#### Scenario: Versions are out of sync

- **WHEN** `packages/cli/package.json` has version `0.1.0` and `skills/taskless-info/SKILL.md` has `metadata.version: "0.0.5"`
- **THEN** running the script SHALL update the SKILL.md to `metadata.version: "0.1.0"`

#### Scenario: Versions are already in sync

- **WHEN** all SKILL.md files already have `metadata.version` matching the CLI version
- **THEN** running the script SHALL make no file changes

#### Scenario: Multiple skills are updated

- **WHEN** 5 SKILL.md files exist under `skills/`
- **THEN** the script SHALL update all 5 files' `metadata.version` fields

### Requirement: Slash command files are hand-authored

Since the v0.7 consolidation, the single `commands/tskl/tskl.md` slash command is hand-authored rather than generated from a `SKILL.md` body. The command body intentionally differs from the skill body (it is a `$ARGUMENTS`-aware router), so the prior "copy SKILL.md body to command" generation script no longer applies.

#### Scenario: Single hand-authored command file exists

- **WHEN** inspecting the repository
- **THEN** `commands/tskl/tskl.md` SHALL exist as a hand-authored file
- **AND** there SHALL be no `scripts/generate-commands.ts` script
- **AND** the root `package.json` SHALL NOT reference `build:generate-commands`

### Requirement: Version sync runs as part of changeset version

The root `package.json` SHALL define a `version` script that runs `changeset version` followed by `tsx scripts/sync-skill-versions.ts`. This ensures skill versions are updated in the same commit as the package version bump.

#### Scenario: Version script chains changeset and sync

- **WHEN** a developer runs `pnpm version`
- **THEN** `changeset version` SHALL run first to bump `packages/cli/package.json`
- **AND** `sync-skill-versions.ts` SHALL run second to update SKILL.md files
- **AND** all changes SHALL be in the working directory ready for commit

### Requirement: Build-time version assertion

The CLI's Vite build SHALL assert that every embedded skill's `metadata.version` matches the CLI's `package.json` version. If any skill has a mismatched version, the build SHALL fail with an error identifying the mismatched skill(s).

#### Scenario: All versions match

- **WHEN** all embedded SKILL.md files have `metadata.version` matching the CLI version
- **THEN** the Vite build SHALL succeed

#### Scenario: Version mismatch detected

- **WHEN** `skills/taskless-info/SKILL.md` has `metadata.version: "0.0.4"` but the CLI is at `0.0.5`
- **THEN** the Vite build SHALL fail with an error message identifying `taskless-info` as having version `0.0.4` (expected `0.0.5`)

### Requirement: CLI release script is removed

The `packages/cli/package.json` SHALL NOT have a `release` script. Build and publish SHALL be orchestrated from the root via turbo.

#### Scenario: No release script in CLI package

- **WHEN** inspecting `packages/cli/package.json` scripts
- **THEN** there SHALL be no `release` key

## Repository Configuration

### Requirement: Turborepo is configured at the repo root

The repository SHALL have `turbo` as a root devDependency and a `turbo.json` configuration file at the repo root.

#### Scenario: Turborepo is installed

- **WHEN** `pnpm install` is run at the repo root
- **THEN** the `turbo` binary SHALL be available

#### Scenario: turbo.json exists

- **WHEN** the repo root is inspected
- **THEN** a `turbo.json` file SHALL exist with valid Turborepo configuration

### Requirement: Build pipeline runs across all packages

The root `pnpm build` command SHALL invoke `turbo run build`, which runs the `build` script in every workspace package that defines one. Build outputs (`dist/**`, `dist-dev/**`, `dist-self/**`) SHALL be cached.

#### Scenario: Root build command runs CLI build

- **WHEN** `pnpm build` is run at the repo root
- **THEN** Turborepo SHALL execute `build` in `@taskless/cli`
- **AND** the CLI `dist/` output SHALL be produced

#### Scenario: Cached build skips re-execution

- **WHEN** `pnpm build` is run twice without source changes
- **THEN** the second run SHALL be a cache hit and complete near-instantly

### Requirement: Test pipeline runs across all packages

The root `pnpm test` command SHALL invoke `turbo run test`, which runs the `test` script in every workspace package that defines one. The test pipeline SHALL depend on the build pipeline so that built artifacts are available.

#### Scenario: Root test command runs CLI tests

- **WHEN** `pnpm test` is run at the repo root
- **THEN** Turborepo SHALL execute `test` in `@taskless/cli`
- **AND** the build pipeline SHALL run first if needed

### Requirement: Typecheck pipeline runs across all packages

The root `pnpm typecheck` command SHALL invoke `turbo run typecheck`, which runs the `typecheck` script in every workspace package that defines one.

#### Scenario: Root typecheck command runs CLI typecheck

- **WHEN** `pnpm typecheck` is run at the repo root
- **THEN** Turborepo SHALL execute `typecheck` in `@taskless/cli`

## Continuous Integration

### Requirement: CI workflow exists

A GitHub Actions workflow file SHALL exist at `.github/workflows/ci.yml`.

#### Scenario: Workflow file is present

- **WHEN** inspecting the repository
- **THEN** `.github/workflows/ci.yml` SHALL exist and be valid YAML

### Requirement: Workflow triggers on PRs and main pushes

The workflow SHALL trigger on pull requests targeting the `main` branch and on pushes to the `main` branch.

#### Scenario: Pull request triggers workflow

- **WHEN** a pull request is opened or updated targeting `main`
- **THEN** the CI workflow SHALL run

#### Scenario: Push to main triggers workflow

- **WHEN** a commit is pushed to `main`
- **THEN** the CI workflow SHALL run

#### Scenario: Push to non-main branch does not trigger

- **WHEN** a commit is pushed to a branch other than `main` without a PR
- **THEN** the CI workflow SHALL NOT run

### Requirement: Workflow runs lint check

The workflow SHALL run `pnpm lint` and the job SHALL fail if linting reports errors.

#### Scenario: Lint passes

- **WHEN** the codebase has no lint errors
- **THEN** the lint step SHALL succeed

#### Scenario: Lint fails

- **WHEN** the codebase has lint errors
- **THEN** the lint step SHALL fail and the workflow SHALL report failure

### Requirement: Workflow runs type checking

The workflow SHALL run `pnpm typecheck` and the job SHALL fail if type errors are found.

#### Scenario: Type check passes

- **WHEN** all packages have no type errors
- **THEN** the typecheck step SHALL succeed

#### Scenario: Type check fails

- **WHEN** a package has type errors
- **THEN** the typecheck step SHALL fail and the workflow SHALL report failure

### Requirement: Workflow runs build

The workflow SHALL run `pnpm build` and the job SHALL fail if the build fails.

#### Scenario: Build succeeds

- **WHEN** all packages build without errors
- **THEN** the build step SHALL succeed

#### Scenario: Build fails

- **WHEN** a package fails to build
- **THEN** the build step SHALL fail and the workflow SHALL report failure

### Requirement: Workflow runs tests

The workflow SHALL run `pnpm test` and the job SHALL fail if any tests fail.

#### Scenario: Tests pass

- **WHEN** all test suites pass
- **THEN** the test step SHALL succeed

#### Scenario: Tests fail

- **WHEN** a test suite has failures
- **THEN** the test step SHALL fail and the workflow SHALL report failure

### Requirement: Workflow uses pnpm matching packageManager field

The workflow SHALL install pnpm using a version consistent with the `packageManager` field in the root `package.json`.

#### Scenario: pnpm version matches

- **WHEN** the workflow installs dependencies
- **THEN** the pnpm version used SHALL match the version specified in `packageManager`

### Requirement: Workflow uses Node 22

The workflow SHALL use Node.js version 22.

#### Scenario: Node version is 22

- **WHEN** the workflow runs
- **THEN** Node.js 22 SHALL be the active runtime

### Requirement: Workflow does not publish

The workflow SHALL NOT include any publish, release, or npm registry push steps.

#### Scenario: No publish steps

- **WHEN** inspecting the workflow file
- **THEN** there SHALL be no steps that run `pnpm publish`, `npm publish`, or interact with an npm registry

## Requirements

### Requirement: Script-versioned packages are excluded from changesets

Workspace packages whose versions are assigned by a release workflow SHALL be listed in the changesets `ignore` configuration, so that changesets neither versions nor publishes them and no changeset is required for them.

#### Scenario: Changesets does not version the platform packages

- **WHEN** `changeset version` runs
- **THEN** the workflow-versioned platform packages are left at their current versions

#### Scenario: Changesets does not publish the platform packages

- **WHEN** the release flow publishes on the default branch
- **THEN** it publishes only the packages changesets manages, and the platform packages are untouched

#### Scenario: A platform-package change needs no changeset

- **WHEN** a pull request modifies only workflow-versioned platform packages
- **THEN** the changeset requirement check does not fail for the absence of a changeset
