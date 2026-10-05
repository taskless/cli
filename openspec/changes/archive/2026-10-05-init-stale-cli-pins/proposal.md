## Why

An upgrade is usually run through a launcher, `npx @taskless/cli@latest init`,
and the launcher leaves the project's own pins alone. A `devDependencies` entry
of `^0.10.2`, or a script spelling out `npx @taskless/cli@0.10.2 check`, is
what CI, a git hook and `pnpm lint` actually run. After the upgrade those run a
CLI older than the `.taskless/` it now finds, and an older CLI refuses a layout
newer than it understands ("Upgrade the CLI to continue"). Nothing about the
upgrade itself fails, so the first sign is a red CI run on the next push, and it
does not read as an upgrade problem when it arrives.

The upgrade trailer already tells the caller what to commit and that `update`
exists. It says nothing about the one other place the upgrade is incomplete.

## What Changes

- `taskless init`, both the batch path and the wizard, reads `package.json` in
  the working directory and names every pin of `@taskless/cli` or
  `@taskless/cli-nightly` whose ceiling sits below the running CLI: an exact
  version, or a `^`/`~` range that cannot reach it, in `dependencies`,
  `devDependencies`, `optionalDependencies`, or spelled out in a script. It
  offers the bump; it does not make it.
- A dependency is judged by the version installed under `node_modules/` as
  well as by its range. `pnpm add -D` writes `^0.11.0` and locks 0.11.0; the
  range admits 0.11.2, but CI runs the locked 0.11.0. Exact and installed
  versions compare with semver precedence, so an older nightly of the same
  base is stale.
- Each pin is named with the version to move it to, on the package that
  publishes it: no `@taskless/cli-nightly@<release>` exists, so a nightly pin
  under a release CLI moves to `@taskless/cli`, and the reverse.
- When the same run migrated an EXISTING `.taskless/`, the notice states the
  breakage as certain rather than likely: a CLI that predates the new schema
  refuses the project with `SCAFFOLD_VERSION_MISMATCH`, so CI breaks on the
  push carrying the migrated files, and the bump belongs in that same commit.
  A fresh install migrates from schema 0 and is not called an upgrade.
- The `init` recipe goes to topic v3: its envelope example and field list
  carry `pinnedCli`, "stop when `changed` is false" now also requires no
  stale pins, and a step offers the bump.
- `init --json` carries the pins as `pinnedCli`, always present, empty when
  nothing is stale.
- The `update` recipe goes to topic v13 with a step telling the agent to offer
  the bump as part of the upgrade, without making it silently.
- `compareVersions` moves from `reconcile-marker.ts` to
  `util/version-compare.ts`, unchanged, so both callers share it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-init`: one ADDED requirement. No standing requirement is restated,
  renamed or removed. The notice is separate from the upgrade trailer, so the
  standing "a no-op re-install prints no upgrade trailer" scenario still holds.

## Impact

Additive output on `init`, plus one envelope field. `patch`: the package is
pre-1.0. A spec this change cannot bound (`latest`, `*`, `>=`, `workspace:`, a
URL) is not reported, so a project that floats its pin sees nothing new.

## Delivery shape

**Single PR.** The spec, detector, wiring, recipe step and tests are one small
reviewable diff. It is the tip, so the change is archived here.
