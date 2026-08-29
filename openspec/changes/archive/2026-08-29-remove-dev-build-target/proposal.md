## Why

The `dev` build target exists for exactly one job: emit a CLI whose baked
invocation is an absolute path (`node /abs/path/packages/cli/dist-dev/index.js`)
so that an unmerged build in this checkout can be exercised from **another**
repository. Nothing else distinguishes it from `self`, which does the same
dogfooding inside this repository with a repo-relative path.

That job now has a better answer. Other repositories consume
`@taskless/cli-nightly`, a published, version-pinned artifact that resolves on
any machine and that the `nightly` target already emits correctly. An absolute
path baked into shipped skill and recipe content is the weaker mechanism: it is
machine-specific, it names a path that may not exist, and it needs a build
notice banner to explain itself.

Keeping `dev` costs a fourth branch in every place the target set is spelled
out: the resolver, the output directories, the invocation switch, the notice
builder, two package manifests, the turbo cache, the eslint ignores, two
tsconfigs, the README table, and the specified build-output contract.

## What Changes

- **The `dev` target is removed.** `build:dev` in both manifests, `OUT_DIRS.dev`,
  the `dev` branches of `resolveCliInvocation` and `resolveCliNotice`, and every
  mention of `dist-dev` in tooling configuration.
- **`TASKLESS_BUILD_TARGET=dev` is rejected, not ignored.** An unknown target
  still falls back to `prod`. A stale `dev` does not: it names a retired target
  and gets an error saying so. Falling back would hand the caller a prod build
  in `dist/` while they went looking for `dist-dev/index.js`, which is a
  confusing failure at a path nobody will grep for.
- **`self`, `prod`, and `nightly` are untouched.** Their output directories,
  invocations, notices, and version handling are unchanged.
- **The accepted trade is documented.** `CONTRIBUTING.md` states plainly that no
  build target emits an artifact runnable outside this checkout, and that this
  is deliberate.

The trade: unmerged work can no longer be exercised from another repository.
Inside this repository `build:self` still covers it; elsewhere the work merges
to `main` and the nightly that follows carries it. This is intended.

**Delivery is a single PR.** The target is one concept spelled out in a dozen
places, and removing half of them leaves a build that does not run. Spec,
implementation, and archive land together.

## Capabilities

### Modified Capabilities

- `infrastructure`: the set of cached build outputs no longer includes
  `dist-dev/**`, because no build emits it.

## Impact

- **Modified**: `package.json`, `packages/cli/package.json`,
  `packages/cli/scripts/build-target.ts`,
  `packages/cli/test/build-target.test.ts`, `turbo.json`, `eslint.config.js`,
  `.gitignore`, `tsconfig.json`, `packages/cli/tsconfig.json`,
  `packages/cli/tsconfig.prompts.json`, `packages/cli/vite.config.ts`,
  `packages/cli/src/util/invocation.ts`, `README.md`, `CONTRIBUTING.md`.
- **Unchanged**: every code path for `prod`, `self`, and `nightly`; the
  published package's behavior; `openspec/changes/archive/**`, whose references
  to `build:dev` record what was true when they landed.
