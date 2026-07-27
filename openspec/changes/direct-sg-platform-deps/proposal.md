## Why

The CLI depends on `@ast-grep/cli`, a wrapper package whose only job is to run a `postinstall` that hardlinks the real binary out of a platform package and into itself, so its `bin: {sg, ast-grep}` entries work. We don't use those `bin` entries — all three call sites resolve the platform package directly via `findSgBinary()` and exec by path. We carry the wrapper, and its install-time step, for a shim we never invoke.

That step is not free. `findSgBinary()`'s own comment records why it exists: the hardlink **fails under `pnpm dlx`'s strict dependency isolation, leaving a placeholder text file** where the binary should be. The wrapper also requires a dependency build script to run at all, which pnpm 10 blocks by default.

`add-vale-binary-packages` establishes the pattern for Vale: platform packages as `optionalDependencies`, resolved and executed by path, no lifecycle script anywhere. ast-grep should use the same one — for it, that means removing a layer rather than adding one.

## What Changes

- Replace the `@ast-grep/cli` dependency with direct `optionalDependencies` on the `@ast-grep/cli-<platform>` packages, which are independently published with `os`/`cpu` declared and carry no scripts and no `bin`.
- Pin every platform package to the same exact ast-grep version, keeping the set in lockstep.
- Keep `findSgBinary()`'s resolution order unchanged — it already prefers the platform package; only the `PATH` fallback's meaning narrows, from "the wrapper's `.bin` shim or a host install" to "a host install".
- Remove the CLI's dependence on any dependency lifecycle script running.

## Capabilities

### Modified Capabilities

- `cli`: The CLI declares ast-grep platform packages as `optionalDependencies` pinned to an exact version instead of depending on the `@ast-grep/cli` wrapper, and its ast-grep binary is resolved without any install-time step.

## Impact

- **Modified**: `packages/cli/package.json` (drop `@ast-grep/cli`, add the platform packages), the lockfile, and possibly `buildPath()` in `packages/cli/src/rules/scan.ts` if the `node_modules/.bin` augmentation no longer earns its place.
- **Unchanged**: all three ast-grep call sites (`rules/scan.ts:69`, `rules/verify.ts:157`, `rules/runtime/narrow.ts:43`) already route through `findSgBinary()`, so the happy path needs no code change.
- **Related**: `add-vale-binary-packages` applies this same model to Vale. This change makes the two engines consistent, and lets one shared resolver serve both (`add-vale-rule-engine` task 5.1).
- **Behavioral risk**: platforms where no `@ast-grep/cli-<platform>` package exists — notably musl/Alpine — lose the wrapper's fallback path and rely on `PATH` alone.
