# Infrastructure

## Purpose

Defines build tooling, CI pipelines, and repository configuration including version sync, command generation, Turborepo setup, and GitHub Actions workflows.

## Requirements

**Build tooling.** Grouped by a bold line rather than a heading: a second `##`
inside the requirements section ends it, and every requirement after it
stops being read.

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

The single `commands/tskl/tskl.md` slash command SHALL be hand-authored rather than generated from a `SKILL.md` body. Its body intentionally differs from the skill body (it is a `$ARGUMENTS`-aware router), so the prior "copy SKILL.md body to command" generation script SHALL NOT be reintroduced.

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

**Repository configuration.**

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

**Continuous integration.**

### Requirement: CI workflow exists

A GitHub Actions workflow file SHALL exist at `.github/workflows/ci.yml`.

#### Scenario: Workflow file is present

- **WHEN** inspecting the repository
- **THEN** `.github/workflows/ci.yml` SHALL exist and be valid YAML

### Requirement: Workflow triggers on every pull request and main pushes

The workflow SHALL trigger on **every** pull request regardless of its base branch, and on pushes to the `main` branch. The `pull_request` trigger SHALL carry no `branches:` filter, and SHALL name `ready_for_review` alongside the default event types.

Lint, typecheck, and tests have no interest in where a pull request eventually merges, and a `branches: [main]` filter did not reliably reach stacked pull requests: GitHub sometimes resolves a stacked PR's eventual target and sometimes does not, so the filter ran for the lower PRs of a stack and silently stopped for the upper ones — leaving a large change at "ready for review" having never been linted, typechecked, or tested. A filter that works for six PRs and quietly fails on the seventh is worse than one that never worked, because nobody re-checks it. `ready_for_review` is not in the default event set, so without it a draft marked ready gets no fresh run until someone happens to push again.

#### Scenario: Pull request targeting main triggers workflow

- **WHEN** a pull request is opened or updated targeting `main`
- **THEN** the CI workflow SHALL run

#### Scenario: Stacked pull request triggers workflow

- **WHEN** a pull request is opened or updated targeting a branch other than `main`
- **THEN** the CI workflow SHALL run, because the trigger carries no `branches:` filter

#### Scenario: Draft marked ready triggers workflow

- **WHEN** a draft pull request is marked ready for review with no new commits
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

### Requirement: Workflow validates the specs

The workflow SHALL validate `openspec/specs/` on every run, with two checks, and the job SHALL fail if either reports a problem.

The first check runs `openspec validate --all --strict` across every spec, not only the specs a pull request touches: spec rot accumulates in the files nobody is editing, so a changed-files-only check would never surface it.

The second check verifies that every `### Requirement:` heading sits under `## Requirements`. This is not redundant with the first. A second `##` heading inside the requirements section ends it, and every requirement below becomes prose to the parser — not invalid, but unread, so `--strict` reports success having never looked at them. Measured before the check existed, `infrastructure` carried 20 requirements with 1 visible and `skills` carried 7 with 1, both passing `--strict` the entire time. A passing gate is an active claim that the spec was read, which makes a silently truncated spec worse than a red check. Topical grouping inside a requirements section therefore uses a bold lead-in line rather than a heading.

#### Scenario: A malformed spec fails the workflow

- **WHEN** a spec under `openspec/specs/` does not satisfy `--strict` validation
- **THEN** the validation step SHALL fail and the workflow SHALL report failure

#### Scenario: An untouched spec is still validated

- **WHEN** a pull request changes no file under `openspec/specs/` but an existing spec is malformed
- **THEN** the validation step SHALL still fail, because validation is repo-wide

#### Scenario: A truncated requirements section fails the workflow

- **WHEN** a spec contains a `### Requirement:` heading that a `##` heading has placed outside the `## Requirements` section
- **THEN** the visibility step SHALL fail, naming the spec and the number of hidden requirements

#### Scenario: A fenced requirement example does not fail the workflow

- **WHEN** a spec contains a `### Requirement:` line inside a fenced code block as an illustration of the format
- **THEN** the visibility step SHALL NOT count it, because fenced content is documentation rather than a requirement the parser reads

#### Scenario: An unclosed code fence fails the workflow

- **WHEN** a spec reaches end of file with a code fence still open, as happens when an opening fence is lost and its closer is left dangling
- **THEN** the visibility step SHALL fail, because everything after that point is unreadable to the check as well as to the parser

### Requirement: Workflow uses pnpm matching packageManager field

The workflow SHALL install pnpm using a version consistent with the `packageManager` field in the root `package.json`.

#### Scenario: pnpm version matches

- **WHEN** the workflow installs dependencies
- **THEN** the pnpm version used SHALL match the version specified in `packageManager`

### Requirement: Workflow uses Node 24

The workflow SHALL use Node.js version 24.

#### Scenario: Node version is 24

- **WHEN** the workflow runs
- **THEN** Node.js 24 SHALL be the active runtime

### Requirement: Workflow does not publish

The workflow SHALL NOT include any publish, release, or npm registry push steps.

#### Scenario: No publish steps

- **WHEN** inspecting the workflow file
- **THEN** there SHALL be no steps that run `pnpm publish`, `npm publish`, or interact with an npm registry

**Release and publishing.**

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
