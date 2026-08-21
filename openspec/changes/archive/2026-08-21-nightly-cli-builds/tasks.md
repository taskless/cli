Delivery shape: **stacked, merging forward**, three PRs (design D9). Group 1 is the bottom PR and carries the changeset; groups 4 and 5 are the two PRs above it. Groups 2 and 3 are human-gated and are **not** code — a maintainer in GitHub and npm settings, between merges.

## 0. Prerequisites and facts to confirm before writing anything

- [x] 0.1 Re-confirm the live environment configuration with `gh api repos/taskless/cli/environments` — the correction in 1.4 depends on `npm-production` still having `required_reviewers`
- [x] 0.2 Confirm `changeset status --output=<relative-path>` on this repository writes `{ changesets: [...], releases: [{ name, type, oldVersion, changesets, newVersion }] }`, and re-confirm both traps: an absolute path is resolved against the working directory (so `/tmp/x.json` means `<cwd>/tmp/x.json` — written where nobody looks if that directory exists, `ENOENT` if it does not), and stdout carries unrelated workspace-version warnings so the JSON file is the only source to read
- [x] 0.3 Confirm the `@taskless/cli-nightly` name is unclaimed on npm

## 1. PR 1 — split the release workflows (no behavior change)

- [x] 1.1 Create `.github/workflows/release-cli-changeset.yml` from `release.yml`'s `version` job, keeping `concurrency: release-${{ github.ref }}` and the header text explaining why the job holds no credential and no OIDC identity (D5, D6)
- [x] 1.2 Create `.github/workflows/release-cli.yml` from `release.yml`'s `check` and `publish` jobs, keeping them **in one file** — the credential-free gate is what keeps an OIDC-capable job from existing on ordinary pushes, and separating it from the job it protects is the arrangement most likely to be broken by a later partial edit (D5)
- [x] 1.3 Deliberately omit a concurrency group from `release-cli.yml`, and earn that by adding an `npm view` guard immediately before `npm publish` — the `check` job is a separate job, so it cannot close the window between its answer and the publish. `release-vale.yml` guards each tarball the same way. Say both parts in the header, since the omission is only safe because of the guard (D6)
- [x] 1.4 Correct the stale claim carried over from `release.yml`'s header — `npm-production` **does** have a required reviewer, so "No required reviewers (fully automatic once the Version Packages PR merges), by design" is false and must be replaced with what is actually configured and why
- [x] 1.5 Rename `.github/workflows/vale-binaries.yml` → `.github/workflows/release-vale.yml`, preserving the whole header comment. Rename its `name:` to `Release Vale` and its concurrency group to `release-vale` as well — a file called `release-vale.yml` that still announces itself as `Vale Binaries` reproduces the naming mismatch this split exists to remove. Safe to do here because branch protection requires only `Validate` (confirmed in 0.1), so no required check depends on the old display name
- [x] 1.6 Delete `.github/workflows/release.yml`
- [x] 1.7 Check for references to the old filenames — branch protection required checks, `pr-check-openspec.yml`, `require-changeset.yml`, `stack-breadcrumb.yml`, README and docs — and update anything that names `release.yml` or `Vale Binaries`. A renamed workflow means a renamed check, and a required check that no longer reports blocks merges silently
- [x] 1.8 Add the changeset on this branch, before cutting the PRs above it, describing **this PR's scope only** — the workflow split. The stack merges forward, so `CLAUDE.md` requires each unit to extend the changeset with what it actually landed rather than the base promising the whole change up front; a reviewer reading it should see only what has merged. Groups 4 and 5 each extend the same file (never add a second changeset)
- 1.9 **Deferred to #131** — verify on merge that the Version Packages PR flow still opens/updates normally and that an ordinary push instantiates no OIDC-capable job. Not observed; the split merged but nothing has watched a version-PR cycle through it end to end

## 2. Human-gated prerequisite — the `npm-autopublish` environment (before the nightly)

- [x] 2.1 **Maintainer action, in GitHub repository settings:** create an environment named `npm-autopublish` with **no required reviewers** and a deployment branch policy restricting it to `main`. An implementer cannot do this and cannot test around it — a workflow referencing a missing environment fails the run (D7, D8). **As of 2026-08-19 `npm-autopublish` already exists** (created 2026-08-18) with no protection rules — but also with `deployment_branch_policy: null`, i.e. no branch restriction at all. Only the branch policy is outstanding; do not re-create the environment. **Applied and confirmed 2026-08-20**
- [x] 2.2 Confirm via `gh api repos/taskless/cli/environments` that `npm-autopublish` exists, has no `required_reviewers`, and has the branch policy applied. **Confirmed 2026-08-20:** no `required_reviewers`, and `deployment_branch_policy: {custom_branch_policies: true, protected_branches: false}` with exactly one policy, `branch: main`. Note it is the **explicit** custom-policy form rather than the derived `protected_branches: true` — that matters, because the derived form would silently extend publish rights to any branch that later becomes protected

## 3. Human-gated prerequisite — trusted publishing for `@taskless/cli-nightly`

**This group runs while PR 2 is open and unmerged, not before it exists.** It needs the pack script from task 4.1, which PR 2 introduces — so unlike group 2, it cannot be done ahead of the code. The order is: open PR 2, run its pack script from that branch, do the one-time publish and binding below, then merge PR 2. Vale's equivalent step reads as a clean prerequisite only because `vale-prepare.cjs` was already on `main` when it was written; nothing is on `main` here yet.

- [x] 3.1 **Maintainer action, one time:** publish the first `@taskless/cli-nightly` version manually so the name exists — npm has nothing to bind a trusted publisher to until it does. Run the pack script from task 4.1 **on PR 2's branch** and publish the tarball it produces, not the package directory, so the name is not burned on a placeholder version (the trap `vale-binaries.yml` documents). **Done:** `0.11.0-20260820055459x599d3f3` is published with `dist-tags.latest` pointing at it. Note the SHA it names no longer exists — it was a merge commit removed by a later rebase — so this version proves the name is claimed and nothing more
- 3.2 **Deferred to #131** — register (or confirm) the npm trusted-publisher binding for `@taskless/cli-nightly` against `release-cli-nightly.yml` and the `npm-autopublish` environment. There is no fallback token path, by design. This was briefly marked done on the strength of `npm view` showing a published version; that is evidence of the manual bootstrap in 3.1, not of a binding. npm exposes no read API for bindings, so it must be checked in the web UI
- 3.3 **Partly done, remainder deferred to #131** — PR 2 merged. The binding was never independently confirmed, so the first automated publish is also the first test of the OIDC handshake

## 4. PR 2 — the nightly (depends on groups 2 and 3 for its first real run)

- [x] 4.1 Add a pack script under `.github/scripts/` that rewrites `packages/cli/package.json` at pack time to `name: @taskless/cli-nightly` and the stamped version, leaving `bin`, `optionalDependencies`, and the committed manifest untouched — the same shape `vale-prepare.cjs` uses (D2)
- [x] 4.2 Compute the version as `<newVersion>-<yyyymmddhhmmss>x<short-sha>`, reading `newVersion` from the `changeset status --output=` JSON **file** at a repo-relative path (D3, 0.2). **Select the entry from `releases` by `name === "@taskless/cli"`, never `[0]`** — the file is an object whose `releases` array lists every package the pending changesets release, and index 0 is only the CLI while it is the sole changesets-managed package. Taking `[0]` stamps the nightly with another package's version the day a second one is added, and nothing fails loudly when it does
- [x] 4.3 Keep the `x` separator and cover it with a test: a short SHA of all digits beginning with `0` must still produce a valid semantic version. This is the one detail most likely to be "simplified" away by a later reader who sees it as decoration (D3). **Measured while building it:** the leading-zero rule bites only if the separator becomes a `.` — a bare concatenation stays _valid_ (the timestamp's leading digit is never `0`) but forms a 21-digit numeric identifier past exact double precision, so it breaks ordering instead of validity. The test covers both alternatives against the semver grammar rather than only the dotted one
- [x] 4.4 Create `.github/workflows/release-cli-nightly.yml` triggered on push to `main`, with gate 1 running before any dependency install and gate 2 as `npm view @taskless/cli-nightly versions --json` filtered for a version ending in `x<sha>` (D4). **Gate 1 is not a bare directory listing:** `.changeset/` permanently holds `README.md` and `config.json`, so it is never empty; the question is whether any `.changeset/*.md` other than `README.md` exists, which is exactly how `require-changeset.yml` counts them (`grep -viE '/README\.md$'`) — reuse that rule rather than inventing a second one for the same question. **Also measured:** `npm view --json` on a 404 prints an error object to _stdout_ and exits non-zero, so `$(npm view … || echo '[]')` yields unparseable JSON — the fallback must replace the capture, not append to it
- [x] 4.5 Keep the gates credential-free and in their own job, so the publish job — and therefore the OIDC identity — exists only for a run that will actually publish
- [x] 4.6 Publish with `--provenance --access public --tag latest`. `--tag latest` is mandatory: every version is a prerelease and npm will not move the default tag onto one unless told to, so without it the package has versions and no default (D3)
- [x] 4.7 Pass no untrusted text through `${{ }}` into any `run:` body; route computed values through `env:`, following `release-vale.yml`'s rule
- [x] 4.8 Pin `npm` to the same version the other publish workflows pin, and keep `--ignore-scripts` on the install so no lifecycle code runs while the OIDC identity exists
- [x] 4.9 Write the header comment for the file: why `main` and not pull requests (unreviewed code under the `@taskless` scope, and the inverted trust split), why the two gates are in that order, and why the Version Packages merge needs no special case
- [x] 4.10 Document installing a nightly in the README — the package name, that `bin` is `taskless`, and that installing it alongside `@taskless/cli` globally collides and is unsupported
- 4.11 **Deferred to #131** — confirm a nightly actually published through `npm-autopublish`. This run is what proves the environment and the OIDC handshake, and it is the whole reason the nightly precedes the Vale move (D9). It has not happened: the only published nightly is the manual bootstrap from 3.1
- [x] 4.12 Give the CLI build a `nightly` target so a nightly's shipped skills, commands, and recipes name `npx @taskless/cli-nightly@<version>` rather than `npx @taskless/cli` (D2). Extend `resolveBuildTarget`/`resolveCliInvocation`/`OUT_DIRS`, reading the version from `TASKLESS_NIGHTLY_VERSION`, and **fail the build when it is missing or malformed** — falling back to the released invocation is the silent bug this fixes. `nightly` emits to `dist`, unlike `dev`/`self`, because that is what `files: ["dist"]` packs, so it overwrites a local prod build; say so at the call site. **The version must be stamped exactly once and passed to both the build and the pack** — hence `--print-version`, and a pack mode that takes `--version` and rejects `--status`/`--sha` so it _cannot_ recompute from a second clock
- [x] 4.13 Close the fail-open in gate 2 (Copilot review on PR #122): any unreadable `npm view` response landed in the same branch as "no nightly found", so a re-run after a registry hiccup would stamp a new timestamp for the same commit and publish a duplicate nightly successfully, with no error. Classify three ways — present, absent, unreadable — keeping the E404-on-stdout case as a genuine "nothing published yet", and fail the job on anything else

## 5. Deferred to issue #131 — the Vale move and the acceptance verification

**Groups 5 and 6 were removed from this change rather than carried out.** They
are tracked in full at https://github.com/taskless/cli/issues/131.

`main` had been failing `Check for unarchived OpenSpec changes on main` on every
push since `162afa0`, because this change directory was still sitting under
`openspec/changes/`. Issue #127 will make a red `main` suppress nightly
publishing outright, so a red `main` had stopped being cosmetic. Archiving
cleared it immediately; the remaining work is a workflow-configuration change
(move `release-vale.yml` to `npm-autopublish`) plus verification, both of which
stand alone and neither of which any requirement in this change's spec delta
depends on.

The `vale-binary-packages` spec delta was removed from this change along with
them. Archiving would otherwise have written into the published spec that the
Vale workflow "SHALL publish without a human approval step, using the
reviewer-free publishing environment" — which is false: `release-vale.yml` still
names `npm-production`, which has a required reviewer. A spec is the thing later
readers trust, so a requirement describing work that was deferred is worse than
no requirement at all. It moves to #131 with the change that makes it true.

What is NOT deferred, and is genuinely done, is every requirement in the remaining delta:
the workflow split, the pack script, the build target, both publish gates, and
the version stamp all shipped in PRs #116, #119 and #122.
