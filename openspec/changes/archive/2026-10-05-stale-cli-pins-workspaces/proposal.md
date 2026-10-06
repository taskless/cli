## Why

#443 made `taskless init` name a `package.json` pin of the CLI that would run
an older build than the one that just upgraded the project. It left two gaps,
recorded in #445.

It reads only the root `package.json`. In a monorepo the pin usually lives in a
workspace package, and that package's CI job is what runs it, so after an
upgrade that migrated `.taskless/` the job fails with
`SCAFFOLD_VERSION_MISMATCH` and nothing warned. That is the silent break #443
exists to prevent.

And the pins are only on `init`. The `update` recipe is reached after a version
move, possibly in a later session that never saw `init`'s output, so its step 4
tells the agent to re-run `init --json`. That is safe, but `init` is not a read
command, and `update` already runs `info --json` in step 1.

## What Changes

- The detector reads the workspace packages the working directory declares:
  `pnpm-workspace.yaml` `packages`, and the `workspaces` field as an array or
  `{ packages }`. Patterns expand with Node's built-in `fs.glob`, already used
  by the CLI, so no dependency is added. `!` negates, absolute and `..`
  patterns are skipped, `node_modules` and `.git` are never descended into,
  and expansion stops at 500 manifests.
- A dependency's installed version is resolved as Node resolves it: the
  package's own `node_modules` link first (pnpm), then each parent's up to the
  working directory (npm/yarn hoisting).
- Each pin carries `manifest`, the `/`-separated path of its `package.json`,
  separate from `location` rather than folded into it, so `location` keeps
  meaning "the field" and a consumer need not parse it. The notice names it on
  every line, the root included.
- `info --json` carries `pinnedCli` in the same shape; plain `info` lists the
  pins.
- Recipes: `update` topic v15 reads the pins from `info --json` in step 4.
  `info` topic v2 documents the field and a step to offer the bump. `init`
  topic v4 documents `manifest`.
- The existing `init-stale-cli-pins` changeset is extended. #443 has not been
  released (`latest` is 0.11.2), so this is one release note.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-init`: "Init names a package.json pin older than the running CLI" is
  MODIFIED, restated in full under the same title, with every standing
  scenario kept and three added.
- `cli`: one ADDED requirement, "Info reports stale CLI pins". The standing
  `info` requirement is not restated.

## Impact

Additive. `pinnedCli` and `manifest` have never been released, so no consumer
sees a shape change. `patch`: the package is pre-1.0.

## Delivery shape

**Single PR.** Detector, `info` wiring, recipes, spec and tests are one
reviewable diff. It is the tip, so the change is archived here.
