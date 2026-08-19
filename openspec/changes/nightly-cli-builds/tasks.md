Delivery shape: **stacked, merging forward**, three PRs (design D9). Group 1 is the bottom PR and carries the changeset; groups 4 and 5 are the two PRs above it. Groups 2 and 3 are human-gated and are **not** code — a maintainer in GitHub and npm settings, between merges.

## 0. Prerequisites and facts to confirm before writing anything

- [ ] 0.1 Re-confirm the live environment configuration with `gh api repos/taskless/cli/environments` — the correction in 1.4 depends on `npm-production` still having `required_reviewers`
- [ ] 0.2 Confirm `changeset status --output=<relative-path>` on this repository writes `[{ name, type, oldVersion, newVersion }]`, and re-confirm both traps: an absolute path silently writes nothing, and stdout carries unrelated workspace-version warnings so the JSON file is the only source to read
- [ ] 0.3 Confirm the `@taskless/cli-nightly` name is unclaimed on npm

## 1. PR 1 — split the release workflows (no behavior change)

- [ ] 1.1 Create `.github/workflows/release-cli-changeset.yml` from `release.yml`'s `version` job, keeping `concurrency: release-${{ github.ref }}` and the header text explaining why the job holds no credential and no OIDC identity (D5, D6)
- [ ] 1.2 Create `.github/workflows/release-cli.yml` from `release.yml`'s `check` and `publish` jobs, keeping them **in one file** — the credential-free gate is what keeps an OIDC-capable job from existing on ordinary pushes, and separating it from the job it protects is the arrangement most likely to be broken by a later partial edit (D5)
- [ ] 1.3 Deliberately omit a concurrency group from `release-cli.yml`, and say so in the header: the gate makes a duplicate publish a no-op, and the residual TOCTOU is handled by treating a publish failure as possibly-already-published, the way `vale-binaries.yml` already does (D6)
- [ ] 1.4 Correct the stale claim carried over from `release.yml`'s header — `npm-production` **does** have a required reviewer, so "No required reviewers (fully automatic once the Version Packages PR merges), by design" is false and must be replaced with what is actually configured and why
- [ ] 1.5 Rename `.github/workflows/vale-binaries.yml` → `.github/workflows/release-vale.yml` with no behavior change, preserving the whole header comment
- [ ] 1.6 Delete `.github/workflows/release.yml`
- [ ] 1.7 Check for references to the old filenames — branch protection required checks, `pr-check-openspec.yml`, `require-changeset.yml`, `stack-breadcrumb.yml`, README and docs — and update anything that names `release.yml` or `Vale Binaries`. A renamed workflow means a renamed check, and a required check that no longer reports blocks merges silently
- [ ] 1.8 Add the changeset on this branch, before cutting the PRs above it, describing **this PR's scope only** — the workflow split. The stack merges forward, so `CLAUDE.md` requires each unit to extend the changeset with what it actually landed rather than the base promising the whole change up front; a reviewer reading it should see only what has merged. Groups 4 and 5 each extend the same file (never add a second changeset)
- [ ] 1.9 Verify on merge that the Version Packages PR flow still opens/updates normally and that an ordinary push instantiates no OIDC-capable job

## 2. Human-gated prerequisite — the `npm-autopublish` environment (before the nightly)

- [ ] 2.1 **Maintainer action, in GitHub repository settings:** create an environment named `npm-autopublish` with **no required reviewers** and a deployment branch policy restricting it to `main`. An implementer cannot do this and cannot test around it — a workflow referencing a missing environment fails the run (D7, D8)
- [ ] 2.2 Confirm via `gh api repos/taskless/cli/environments` that `npm-autopublish` exists, has no `required_reviewers`, and has the branch policy applied

## 3. Human-gated prerequisite — trusted publishing for `@taskless/cli-nightly`

**This group runs while PR 2 is open and unmerged, not before it exists.** It needs the pack script from task 4.1, which PR 2 introduces — so unlike group 2, it cannot be done ahead of the code. The order is: open PR 2, run its pack script from that branch, do the one-time publish and binding below, then merge PR 2. Vale's equivalent step reads as a clean prerequisite only because `vale-prepare.cjs` was already on `main` when it was written; nothing is on `main` here yet.

- [ ] 3.1 **Maintainer action, one time:** publish the first `@taskless/cli-nightly` version manually so the name exists — npm has nothing to bind a trusted publisher to until it does. Run the pack script from task 4.1 **on PR 2's branch** and publish the tarball it produces, not the package directory, so the name is not burned on a placeholder version (the trap `vale-binaries.yml` documents)
- [ ] 3.2 **Maintainer action:** register the npm trusted-publisher binding for `@taskless/cli-nightly` against `release-cli-nightly.yml` and the `npm-autopublish` environment. There is no fallback token path, by design
- [ ] 3.3 Confirm the binding, then merge PR 2 — the binding must exist before the first automated publish, or PR 2 merges into a workflow whose first run fails the OIDC handshake

## 4. PR 2 — the nightly (depends on groups 2 and 3 for its first real run)

- [ ] 4.1 Add a pack script under `.github/scripts/` that rewrites `packages/cli/package.json` at pack time to `name: @taskless/cli-nightly` and the stamped version, leaving `bin`, `optionalDependencies`, and the committed manifest untouched — the same shape `vale-prepare.cjs` uses (D2)
- [ ] 4.2 Compute the version as `<newVersion>-<yyyymmddhhmmss>x<short-sha>`, reading `newVersion` from the `changeset status --output=` JSON **file** at a repo-relative path (D3, 0.2). **Select the entry by `name === "@taskless/cli"`, never `[0]`** — the output is an array of every package the pending changesets release, and index 0 is only the CLI while it is the sole changesets-managed package. Taking `[0]` stamps the nightly with another package's version the day a second one is added, and nothing fails loudly when it does
- [ ] 4.3 Keep the `x` separator and cover it with a test: a short SHA of all digits beginning with `0` must still produce a valid semantic version. This is the one detail most likely to be "simplified" away by a later reader who sees it as decoration (D3)
- [ ] 4.4 Create `.github/workflows/release-cli-nightly.yml` triggered on push to `main`, with gate 1 as a **listing of `.changeset/*.md` excluding `README.md`** that runs before any dependency install (`.changeset/` also permanently holds `README.md` and `config.json`, so a bare emptiness test is never true — `require-changeset.yml` already counts them this way with `grep -viE '/README\.md$'`), and gate 2 as `npm view @taskless/cli-nightly versions --json` filtered for a version ending in `x<sha>` (D4)
- [ ] 4.5 Keep the gates credential-free and in their own job, so the publish job — and therefore the OIDC identity — exists only for a run that will actually publish
- [ ] 4.6 Publish with `--provenance --access public --tag latest`. `--tag latest` is mandatory: every version is a prerelease and npm will not move the default tag onto one unless told to, so without it the package has versions and no default (D3)
- [ ] 4.7 Pass no untrusted text through `${{ }}` into any `run:` body; route computed values through `env:`, following `release-vale.yml`'s rule
- [ ] 4.8 Pin `npm` to the same version the other publish workflows pin, and keep `--ignore-scripts` on the install so no lifecycle code runs while the OIDC identity exists
- [ ] 4.9 Write the header comment for the file: why `main` and not pull requests (unreviewed code under the `@taskless` scope, and the inverted trust split), why the two gates are in that order, and why the Version Packages merge needs no special case
- [ ] 4.10 Document installing a nightly in the README — the package name, that `bin` is `taskless`, and that installing it alongside `@taskless/cli` globally collides and is unsupported
- [ ] 4.11 Confirm a nightly actually published through `npm-autopublish` before PR 3 is opened — this run is what proves the environment and the OIDC handshake, and it is the whole reason the nightly precedes the Vale move (D9)

## 5. PR 3 — move Vale to `npm-autopublish` (depends on a proven nightly publish, group 4)

- [ ] 5.1 Change the `publish` job's `environment:` in `release-vale.yml` from `npm-production` to `npm-autopublish`
- [ ] 5.2 Update the header comment's "PUBLISHING IDENTITY" paragraph to name the new environment and to state the reason: the manifest-update PR is the review gate, and the CLI's exact pins mean an auto-published package reaches no user until someone bumps the pin (D7)
- [ ] 5.3 Confirm the npm trusted-publisher bindings for all six `@taskless/vale-*` packages still authorize the workflow after the environment change — the binding names the workflow, and an environment change must not invalidate it. If npm's binding is environment-scoped, re-register before merging
- [ ] 5.4 Verify with a `workflow_dispatch` `publish --force` run that the Vale set publishes with no approval click
- [ ] 5.5 Do not merge this PR before a nightly has published through `npm-autopublish` (4.11). Moving Vale first would risk breaking a working release path to enable a convenience; moving it second means the destination is proven
- [ ] 5.6 Archive the change on this PR, as the tip of the stack

## 6. Verify the acceptance criteria on `main`

- [ ] 6.1 A push to `main` with pending changesets publishes `@taskless/cli-nightly@<proposedBump>-<timestamp>x<sha>` with the default tag and provenance
- [ ] 6.2 A push to `main` carrying no pending changeset — `.changeset/` holding only `README.md` and `config.json` — publishes no nightly **and exits before installing anything** — check the run log, not just the outcome
- [ ] 6.3 A workflow re-run on an already-built SHA publishes nothing
- [ ] 6.4 The merge of a Version Packages PR publishes the real release and no nightly, with no special case in either workflow
- [ ] 6.5 Vale publishes with no click; `@taskless/cli` still waits for one
- [ ] 6.6 `release-cli-changeset.yml` still holds the original concurrency group, and no other release workflow has acquired one
- [ ] 6.7 Install a published nightly in a clean directory and confirm `taskless --version` reports the nightly version and the CLI runs
