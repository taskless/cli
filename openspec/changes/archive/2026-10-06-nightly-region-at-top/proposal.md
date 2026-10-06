## Why

The nightly build-info region is the part of the Version Packages pull request a
reviewer acts on: it is the install line for the build that carries the pending
changesets. At the end of the body it sits below the full release notes, which
grow with every changeset, so the one actionable line is the hardest to find.

## What Changes

- **`cli-nightly-builds`**: "A published nightly is announced on the pending
  release pull request" places the region at the top of the body's description
  instead of at the end. A leading stack-breadcrumb region stays first, and the
  nightly region goes directly below it.
- `nightly-breadcrumb.cjs` inserts the region there. Below a leading stack
  region is also where `stack-breadcrumb.cjs`'s `canonicalizeBody` leaves it, so
  the two writers now agree on one layout. Before this, a stack re-lay moved the
  region out of last place, and the next publish moved it back.

## Impact

- `.github/scripts/nightly-breadcrumb.cjs` and its tests, plus the header
  comment in `.github/workflows/release-cli-nightly.yml`.
- No changeset: CI-only, nothing ships in `@taskless/cli`.

## Delivery shape

**Single PR.** The change is a placement rule, its implementation, and tests;
it fits one small diff, and the archive lands with it.
