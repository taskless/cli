## Why

Work that has merged to `main` but has not been released is unreachable. `@taskless/cli` is a workspace package with a build step, so there is no `npx` incantation against a branch, a tag, or a tarball that a person would realistically type — the only installable artifact is the last release. Between releases, "does the fix actually work when installed?" cannot be answered by anyone, including us.

At the same time `release.yml` has grown two release designs in one file. The credential-free `version` job that consumes untrusted changeset text and the OIDC-credentialed `publish` job share a trigger, a concurrency group, and a header comment that is now wrong about the environment it describes. Adding a third design — an unattended nightly publish — to that file would make the trust story harder to read at exactly the moment it needs to be clearer.

## What Changes

- **Publish `@taskless/cli-nightly` from `main`.** Same source, same `bin: taskless`, published under a different name so nightlies never appear in `@taskless/cli`'s version history. Built from `main` only: the code has already passed review, and no contributor-authored text reaches the credentialed job.
- **Version as `n.m.k-yyyymmddhhmmssx<sha>`** (e.g. `0.11.0-20260818123456x05b3c88`), where `n.m.k` is the bump `main`'s pending changesets propose. The timestamp sorts; the SHA identifies and dedupes.
- **Gate on two questions, in order:** is `.changeset/` empty (nothing pending, nothing to build), and has this SHA already been published?
- **Split `release.yml` into four workflows,** one release design each: `release-cli-changeset.yml`, `release-cli.yml`, `release-vale.yml`, `release-cli-nightly.yml`.
- **Add an `npm-autopublish` environment** for flows that publish without a human click, and **move the Vale platform packages into it.** `@taskless/cli` keeps `npm-production` and its required reviewer.
- **Correct `release.yml`'s stale header claim** that `npm-production` has no required reviewers. It does — confirmed via `gh api repos/taskless/cli/environments` — and the comment has been asserting the opposite.

**Two prerequisites are human-gated and cannot be worked around by an implementer:** the `npm-autopublish` environment must be created in repository settings, and a trusted-publisher binding for `@taskless/cli-nightly` must be registered on npm. Trusted publishing is configured per package and the package does not exist yet, so the first publish is a deliberate manual step. Until both are done the nightly workflow cannot be verified end to end.

**Delivery is stacked, merging forward, in three PRs: the workflow split, then the nightly, then the Vale move.** The nightly comes before the Vale move deliberately. `npm-autopublish` is an unproven credential path, and Vale's six trusted-publisher bindings were registered against `npm-production` — if they turn out to be environment-scoped, migrating Vale first breaks a working release path with no stored token to fall back on. The nightly exercises the same environment and the same OIDC handshake on a package where a failed first publish costs nothing. See design D8 for the prerequisites, D9 for the ordering, and D10 for the shape.

## Capabilities

### New Capabilities

- `cli-nightly-builds`: publishing every unreleased `main` commit as `@taskless/cli-nightly`, including the version scheme, the two gates, and the guarantee that a nightly is a drop-in for the release it anticipates.

### Modified Capabilities

- `infrastructure`: the release flow becomes one workflow per release design, each with a self-contained trust story; publishing environments are distinguished by whether a human click gates them; the concurrency guarantee is narrowed to the flow that needs it.
- `vale-binary-packages`: the Vale release moves from `npm-production` to `npm-autopublish`, making explicit that its review gate is the manifest-update pull request rather than an environment approval.

## Impact

- **Removed**: `.github/workflows/release.yml`.
- **Added**: `.github/workflows/release-cli-changeset.yml` (Version Packages PR, no credential), `.github/workflows/release-cli.yml` (publishes `@taskless/cli`, `npm-production`, approval), `.github/workflows/release-cli-nightly.yml` (nightly, `npm-autopublish`), and a nightly pack script under `.github/scripts/`.
- **Renamed**: `.github/workflows/vale-binaries.yml` → `.github/workflows/release-vale.yml`, with its `publish` job moved to `npm-autopublish`.
- **Outside the repository**: the `npm-autopublish` GitHub environment, and an npm trusted-publisher binding for `@taskless/cli-nightly`.
- **Unchanged**: `packages/cli/package.json` as committed. The rename to `@taskless/cli-nightly` is a pack-time rewrite, the way `vale-prepare.cjs` already stamps the Vale packages. `optionalDependencies` are untouched — a nightly points at the same published, pinned Vale and ast-grep platform packages the release does.
- **Out of scope**: pruning old nightly versions from the registry.

**Tracking:** taskless/cli#111
