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

The root `pnpm build` command SHALL invoke `turbo run build`, which runs the `build` script in every workspace package that defines one. Build outputs (`dist/**`, `dist-self/**`) SHALL be cached.

The cached output set SHALL name only directories a build target emits. `dist-dev/**` is no longer among them: the `dev` build target has been removed, and no build writes that directory.

#### Scenario: Root build command runs CLI build

- **WHEN** `pnpm build` is run at the repo root
- **THEN** Turborepo SHALL execute `build` in `@taskless/cli`
- **AND** the CLI `dist/` output SHALL be produced

#### Scenario: Cached build skips re-execution

- **WHEN** `pnpm build` is run twice without source changes
- **THEN** the second run SHALL be a cache hit and complete near-instantly

#### Scenario: No cached output is declared for a removed target

- **WHEN** `turbo.json` is inspected
- **THEN** the `build` task outputs SHALL NOT include `dist-dev/**`

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

### Requirement: Validation workflow exists

A GitHub Actions workflow file SHALL exist at `.github/workflows/validate.yml`, and its job SHALL be named `Validate` to match the required status check configured on `main`.

#### Scenario: Workflow file is present

- **WHEN** inspecting the repository
- **THEN** `.github/workflows/validate.yml` SHALL exist and be valid YAML

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

### Requirement: No check requires an OpenSpec change to be archived

No workflow SHALL fail because a directory other than `archive/` exists under `openspec/changes/`, on a pull request or on `main`. An unarchived change directory is the normal state of work in progress, and no check status reports it.

Two gates were tried and both measured the wrong thing. A pull-request gate had to infer stack position to avoid firing on work still in flight, and a check that is expected-red across most of a stack trains people to ignore red. Moving it to `main` removed those false positives and introduced a worse one: a stack that merges forward leaves its change directory on `main` until the final slice, so `main` ran red for as long as the stack took to drain. A signal that is expected to be red is not a signal.

Both versions detected "work is in progress". What is worth detecting is work that stalled and was abandoned, and the directory looks identical in either case, so neither gate could tell them apart.

The replacement reports through channels that tolerate being wrong — a pull-request label, a job summary, and a tracking issue — rather than through a check status. Those signals are specified below. None of them fails a check, so this requirement is unchanged in what it forbids: reporting exists, blocking does not.

#### Scenario: Unarchived change on a pull request does not fail

- **WHEN** a pull request carries an unarchived change directory under `openspec/changes/`
- **THEN** no check SHALL fail for it

#### Scenario: Unarchived change on main does not fail

- **WHEN** a commit is pushed to `main` and a directory other than `archive/` exists under `openspec/changes/`
- **THEN** no check SHALL fail for it, because a forward-merging stack is expected to leave one there until its final slice

#### Scenario: The reporting signals conclude successfully when they fire

- **WHEN** any OpenSpec reporting signal detects an unarchived or unclaimed change
- **THEN** it SHALL record the finding in a label, a job summary, or an issue, and SHALL conclude the workflow run successfully

#### Scenario: No reporting signal is a step in the validation workflow

- **WHEN** the OpenSpec reporting signals run
- **THEN** none of them SHALL be a step in the workflow named `Validate`, so that a nightly publish triggered by `workflow_run` on that workflow cannot be gated by one

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
- **THEN** the changeset check does not fail for the absence of a changeset

### Requirement: The changeset check is advisory and stack-aware

A GitHub Actions workflow SHALL report whether a `.changeset/*.md` other than the template README is added or modified anywhere between `main` and a pull request's head commit. It SHALL emit a warning when none is found and SHALL NOT fail the pull request in any case.

The range is the whole stack, not the pull request's own diff: one change gets one changeset, it lives on the bottom branch, and every branch above inherits it because a child contains its ancestors' commits. Asking each pull request to add its own file made a correct arrangement look like an omission, which is what the `skip-changeset` label was being used to silence. Whether a change ships a release note is a judgement the workflow cannot make, so it reports and leaves the call to the author.

#### Scenario: A changeset on a lower branch of the stack satisfies the check

- **WHEN** a pull request adds no changeset but a branch below it in the stack does
- **THEN** the check SHALL report the changeset as present, because the diff is taken against `main`

#### Scenario: No changeset anywhere in the stack warns without failing

- **WHEN** no changeset is added or modified between `main` and the pull request's head
- **THEN** the check SHALL emit a warning and SHALL still conclude successfully

#### Scenario: The Version Packages pull request is exempt

- **WHEN** the pull request's head branch is `changeset-release/main`
- **THEN** the check SHALL pass without a warning, because consuming changesets is that pull request's purpose

### Requirement: Each release flow lives in its own workflow file

Every release flow SHALL be defined in a workflow file of its own, carrying exactly one release design and a self-contained account of its trust boundary. A workflow file SHALL NOT combine a flow that consumes contributor-authored text with a flow that holds a publishing credential.

There SHALL be one workflow for opening the version pull request, one for publishing the CLI, one for publishing the Vale platform packages, and one for publishing the CLI nightly.

#### Scenario: The version flow holds no credential

- **WHEN** inspecting the workflow that runs the version bump and opens the version pull request
- **THEN** it SHALL request no OIDC identity, reference no publishing environment, and contain no publish step

#### Scenario: Each publishing flow is separately readable

- **WHEN** inspecting any workflow that publishes to the registry
- **THEN** its trust boundary — what it may publish, what gates it, and where its credential comes from — SHALL be documented in that file, without reference to another workflow's reasoning

#### Scenario: Workflow documentation matches the live configuration

- **WHEN** a workflow's comments describe the approval policy of the environment it uses
- **THEN** that description SHALL match the environment's configured policy

### Requirement: A credential-free gate decides whether a credentialed publish job exists

Each publishing flow SHALL decide whether there is anything to publish in a job holding no publishing credential and no OIDC identity, and SHALL instantiate the credentialed job only when that gate says yes. The gate SHALL live in the same workflow file as the job it protects.

#### Scenario: An ordinary push instantiates no credentialed job

- **WHEN** a commit is pushed to the default branch and nothing needs publishing
- **THEN** no job holding an OIDC identity or referencing a publishing environment SHALL run

#### Scenario: The gate and the job it protects are not separated

- **WHEN** inspecting a publishing workflow
- **THEN** the gate deciding whether to publish SHALL be defined in that same file

### Requirement: Publishing environments are distinguished by whether a human approves each release

The repository SHALL define two publishing environments. One SHALL require a human reviewer and SHALL be used by flows where approval decides what users receive by default. The other SHALL require no reviewer and SHALL be used by flows whose review gate is code review or a reviewed pull request, and whose output reaches no user until a separate reviewed change adopts it.

The reviewer-free environment SHALL still carry a branch policy restricting it to the default branch, and SHALL remain the audit boundary and the binding point for the registry's trusted-publisher configuration.

#### Scenario: The released CLI requires an approval

- **WHEN** the released CLI is published
- **THEN** the run SHALL use the environment with a required reviewer

#### Scenario: Unattended flows use the reviewer-free environment

- **WHEN** a flow publishes without a human click
- **THEN** it SHALL use the reviewer-free environment
- **AND** that environment SHALL restrict deployments to the default branch

#### Scenario: A publishing name has a trusted publisher before it is used

- **WHEN** a workflow publishes a package name for the first time
- **THEN** a trusted-publisher binding for that name SHALL already be registered, since the binding is per package and cannot exist before the name does

### Requirement: Release flows are serialized only where a race can corrupt shared state

The workflow that opens and updates the version pull request SHALL run under a concurrency group, because two runs racing on that branch is a real failure.

Publishing workflows SHALL NOT be serialized merely because they publish. Where a credential-free gate makes a duplicate run a no-op, the flow SHALL run unserialized, and the residual window in which two runs both observe "not yet published" SHALL be handled by treating a publish failure as possibly-already-published rather than as an error.

#### Scenario: The version flow is serialized

- **WHEN** two commits are pushed to the default branch in quick succession
- **THEN** the version pull request flow SHALL process them one at a time

#### Scenario: A duplicate publish run is a no-op

- **WHEN** two runs of a publishing flow evaluate the same commit or version
- **THEN** at most one artifact SHALL be published, and the other run SHALL neither fail nor publish a duplicate

### Requirement: The CLI has three build targets

The CLI SHALL support exactly three build targets, selected by `TASKLESS_BUILD_TARGET`: `prod` (the default, emitting `dist/` with the published `npx @taskless/cli` invocation), `self` (emitting `dist-self/` with a repo-root-relative path, for dogfooding inside this repository), and `nightly` (emitting `dist/` with `npx @taskless/cli-nightly@<version>`).

There SHALL NOT be a build target that emits an invocation runnable from outside this repository's checkout. Exercising unreleased behavior elsewhere is served by a published nightly, which resolves on any machine and is pinned to the build whose instructions it carries, rather than by an absolute filesystem path baked into shipped content.

An unset or unrecognized `TASKLESS_BUILD_TARGET` SHALL resolve to `prod`. The retired value `dev` SHALL be an exception: it SHALL fail the build with an error naming the target as removed, because a caller who sets it is looking for an output directory that will not be written, and a silent fall back to `prod` would surface only as a missing file at a path nothing else mentions.

#### Scenario: The self target stays repo-relative

- **WHEN** a build runs with `TASKLESS_BUILD_TARGET=self`
- **THEN** the output SHALL be written to `dist-self/`
- **AND** the baked invocation SHALL be a path relative to the repo root

#### Scenario: A retired target fails loudly

- **WHEN** a build runs with `TASKLESS_BUILD_TARGET=dev`
- **THEN** the build SHALL fail with an error stating the target has been removed
- **AND** SHALL NOT fall back to the `prod` target

#### Scenario: An unknown target still defaults to prod

- **WHEN** a build runs with `TASKLESS_BUILD_TARGET` unset or set to an unrecognized value other than `dev`
- **THEN** the build SHALL resolve to the `prod` target

### Requirement: An unresolved OpenSpec change is labelled on every pull request in its stack

A GitHub Actions workflow SHALL apply the `Open OpenSpec` label to a pull request whose head carries a directory other than `archive/` under `openspec/changes/`, and SHALL remove that label when the head carries none. The determination SHALL be made from the head commit's own tree, without querying pull-request lineage or resolving where the pull request eventually merges.

A stack has not resolved its OpenSpec change until one of its branches archives it, and that is a property of the stack rather than of any branch's position within it. Reading it from the tree gives every pull request in the stack the same answer with no API call to fail. The label is the durable signal: it can be filtered, it survives a re-run, and being occasionally wrong costs nothing, which is what allows the predicate to be simple.

#### Scenario: A pull request holding an unarchived change is labelled

- **WHEN** a pull request's head tree contains a directory other than `archive/` under `openspec/changes/`
- **THEN** the workflow SHALL apply the `Open OpenSpec` label

#### Scenario: The label is removed when the change is archived

- **WHEN** a pull request's head tree contains no directory other than `archive/` under `openspec/changes/`
- **THEN** the workflow SHALL remove the `Open OpenSpec` label if it is present, and SHALL succeed if it is not

#### Scenario: Every branch of a stack receives the same label

- **WHEN** several open pull requests are stacked and the change directory is present in each of their head trees
- **THEN** each SHALL be labelled, because the determination reads the tree rather than the stack

#### Scenario: A fork pull request falls back to the job summary

- **WHEN** the workflow runs on a pull request from a fork and cannot write the label
- **THEN** it SHALL record the finding in the job summary, SHALL state that the label could not be applied, and SHALL conclude successfully
- **AND** it SHALL NOT use the `pull_request_target` event to obtain a writable token

### Requirement: The tip of a stack is warned when it leaves a change unarchived

A GitHub Actions workflow SHALL emit a job-summary warning when a pull request carries an unarchived change under `openspec/changes/` and no other open pull request targets its head branch as a base. It SHALL NOT fail the pull request in any case.

The tip is the last branch that can archive the change before it reaches `main`, so it is the only position where the warning is actionable. Stack position is read from the GitHub API, which introduces a failure mode unrelated to the pull request; the previous version of this check exited non-zero when that read failed, reddening pull requests for `gh` timeouts. Being unable to determine position is not a finding about the pull request and SHALL NOT be reported as one.

#### Scenario: The tip of a stack is warned

- **WHEN** a pull request carries an unarchived change and no open pull request bases on its head branch
- **THEN** the workflow SHALL emit a warning naming the change, and SHALL conclude successfully

#### Scenario: A mid-stack pull request is not warned

- **WHEN** at least one open pull request targets this pull request's head branch as its base
- **THEN** the workflow SHALL emit no warning, because work is still stacked above and the change is not yet due for archiving

#### Scenario: Stack position cannot be determined

- **WHEN** the query for pull requests based on this head branch fails
- **THEN** the workflow SHALL skip the warning, SHALL record that position could not be determined, and SHALL conclude successfully

### Requirement: An unclaimed unarchived change on main opens a tracking issue

A GitHub Actions workflow triggered by pushes to `main` SHALL open or update a tracking issue when a directory other than `archive/` exists under `openspec/changes/` and no open pull request's diff against `main` touches that directory. It SHALL close that issue when the change appears under `archive/`, and SHALL NOT fail the workflow run in any case.

A change on `main` is finished or it has not landed; there is no parked state. So an unarchived change whose work has landed means `openspec/specs/` describes requirements the code has already met — the specs are wrong, not merely out of date, and the issue SHALL say so.

The claim test is what keeps a forward-merging stack quiet: while a stack drains, its remaining pull requests carry the change directory in their diffs, so the change is claimed and nothing is reported. It is a file-path question about open pull requests and SHALL NOT be implemented by reconstructing stack lineage.

Exactly one issue SHALL exist per change. The workflow SHALL locate an existing issue by a machine-readable marker in the issue body rather than by matching its title, and SHALL reopen a closed one rather than opening a second.

#### Scenario: A change left on main with no open claimant opens an issue

- **WHEN** a push to `main` leaves an unarchived change that no open pull request's diff touches
- **THEN** the workflow SHALL open a tracking issue naming the change, stating that the standing specs no longer describe the shipped code, and SHALL conclude successfully

#### Scenario: A draining forward-merging stack reports nothing

- **WHEN** a push to `main` leaves an unarchived change and at least one open pull request's diff touches that change's directory
- **THEN** the workflow SHALL open no issue, because the change is still claimed by work in flight

#### Scenario: Archiving the change closes its issue

- **WHEN** a push to `main` moves a change under `archive/` and a tracking issue for it is open
- **THEN** the workflow SHALL close that issue

#### Scenario: A change that recurs reuses its existing issue

- **WHEN** a tracking issue for a change already exists, whether open or closed
- **THEN** the workflow SHALL update or reopen that issue rather than opening a second one, locating it by the marker in its body

### Requirement: A scheduled sweep backstops the main-side check

A scheduled GitHub Actions workflow SHALL escalate the tracking issue for any change that has been unarchived on `main` for longer than a fixed window, currently seven days. It SHALL determine age from the git history of the change directory and SHALL NOT read file modification times. It SHALL NOT fail the workflow run.

The sweep exists for the case where the push-time check was never evaluated — an administrative merge, a workflow disabled during an outage, a botched down-merge. It is a backstop for a missing evaluation, not a second classifier, so it SHALL NOT parse `tasks.md` and SHALL NOT distinguish finished work from unfinished work. There is no parked state on `main`, so age alone is the whole predicate.

`actions/checkout` stamps every file's modification time to checkout time, so a sweep reading mtime reports every change as fresh regardless of its age.

#### Scenario: A change older than the window is escalated

- **WHEN** the scheduled sweep finds a change unarchived on `main` whose directory has no git activity within the window
- **THEN** it SHALL escalate that change's tracking issue, opening one if none exists, and SHALL conclude successfully

#### Scenario: Age is read from git history

- **WHEN** the sweep determines how long a change has been unarchived
- **THEN** it SHALL read the change directory's git history and SHALL NOT use file modification times

#### Scenario: The sweep does not classify by task completion

- **WHEN** the sweep evaluates a change whose `tasks.md` has unchecked tasks, or which has no `tasks.md`
- **THEN** it SHALL treat the change identically to one whose tasks are all checked, because completeness is not a legitimate reason for a change to remain on `main`
