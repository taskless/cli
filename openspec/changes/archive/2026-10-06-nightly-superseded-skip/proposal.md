## Why

Each commit that passes `Validate` on `main` starts its own nightly run, and
nothing orders those runs. On 2026-10-06 the publish job for `e8b2153` sat 19
minutes in `waiting` on the `npm-autopublish` environment. The environment has
no reviewer and no wait timer, so nobody could approve the run, and it had to be
cancelled by hand (#474). `de43cf6` landed during the wait. Had the stalled run
been released, it would have published with `--tag latest` after the newer
nightly and moved `npm i @taskless/cli-nightly` back to older code.

The version stamp made this worse. Its timestamp was read from the clock inside
the publish job, after the environment wait, so the stalled run would have
stamped itself the newest nightly on npm.

## What Changes

- **`cli-nightly-builds`**: new requirement "A superseded nightly is not
  published". Right before `npm publish`, the run checks npm for a nightly with
  a later timestamp and skips if one exists. Timestamps are compared alone,
  since `n.m.k` can go down between commits. If npm can't be read, the run
  fails.
- **`cli-nightly-builds`**: the version requirement now stamps the commit's
  committer date (UTC), not the build time. `main` is rebase-merge only, so a
  committer date is when GitHub landed the commit, and stamps follow the order
  of `main`.
- **`cli-nightly-builds`**: gate 2's rationale no longer depends on a fresh
  timestamp per build. The announcement requirement now says "commit time" and
  is skipped for a superseded run.
- `nightly-pack.cjs` takes `--date` (required, no clock fallback) and gains
  `hasNewerNightly`. The workflow's publish step runs the check and exposes a
  `published` output that the breadcrumb job is gated on. The breadcrumb's
  label changes from "Built at" to "Committed at".

Rejected: checking whether the SHA is still the tip of `main`, in the gate
job. The gate answers before the environment wait, which is when the newer
commit arrived, so it would not have caught the incident. It also costs the
older commit its nightly when the newer commit fails `Validate`. A job-level
concurrency group was also rejected: it is unknown whether a job held in
`waiting` keeps the slot, and if it does, one stall would block every later
nightly.

## Impact

- `.github/scripts/nightly-pack.cjs`, `.github/scripts/nightly-breadcrumb.cjs`,
  their tests, and `.github/workflows/release-cli-nightly.yml`.
- Re-running a commit now produces the same version, which the existing
  exact-version guard skips.
- A run held in `waiting` still shows as waiting until GitHub releases it. It
  then publishes nothing, so nobody has to cancel it.
- No changeset: CI only, nothing ships in `@taskless/cli`.

## Delivery shape

**Single PR.** One workflow, two scripts, their tests, and the spec delta fit in
one small diff, and the archive lands with it.
