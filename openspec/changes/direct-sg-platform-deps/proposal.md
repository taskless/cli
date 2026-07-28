## Why

The migration to platform packages is already half done. `packages/cli` declares all seven `@ast-grep/cli-<platform>` packages in `optionalDependencies`, and `findSgBinary()` resolves them directly and execs by path — every ast-grep call site already goes through it. What remains is the `@ast-grep/cli` wrapper, still declared as a hard dependency beside them.

The wrapper's only job is a `postinstall` that hardlinks the binary out of a platform package into itself, so its `bin: {sg, ast-grep}` entries resolve. We never invoke those entries. So we carry a redundant dependency, plus its install-time step — a step that has already failed here: `findSgBinary()`'s comment records that the hardlink **breaks under `pnpm dlx`'s strict dependency isolation, leaving a placeholder text file** where the binary should be. It also required opting in to run at all, which is why the root `package.json` lists `@ast-grep/cli` in `pnpm.onlyBuiltDependencies`.

`add-vale-binary-packages` establishes this pattern for Vale. Finishing it for ast-grep means deleting the leftover, not building anything.

## What Changes

- Move `@ast-grep/cli` from `dependencies` to `devDependencies`. The seven platform packages already in `optionalDependencies` become the only ast-grep dependency consumers install, so the wrapper's `postinstall` leaves the shipped product entirely.
- Tighten those declarations from caret ranges (`^0.41.0`) to exactly `0.41.0`, so the set cannot drift apart across hosts. **Held deliberately at `0.41.0`** rather than bumped to upstream's `0.45.0`, keeping this change purely structural.
- Point `scripts/fetch-ast-grep-schema.ts` at the new location — it reads the schema version from `dependencies["@ast-grep/cli"]` and throws when absent, and is the only genuine consumer of that declaration.
- Make binary resolution **exhaust every known location before failing**: platform package, `node_modules/.bin`, then `sg` and `ast-grep` on `PATH`, and a clear error naming what was tried. Today it returns a bare `"sg"` and lets `spawn` produce the failure.

## Capabilities

### Modified Capabilities

- `cli`: The CLI declares ast-grep platform packages as `optionalDependencies` pinned to an exact version instead of depending on the `@ast-grep/cli` wrapper, and its ast-grep binary is resolved without any install-time step.

## Impact

- **Modified**: `packages/cli/package.json` (wrapper to `devDependencies`, platform packages pinned exactly), `packages/cli/scripts/fetch-ast-grep-schema.ts` (version source), `packages/cli/src/rules/scan.ts` (`findSgBinary()` becomes an exhaustive search), and the lockfile.
- **Unchanged**: all three ast-grep call sites (`rules/scan.ts:69`, `rules/verify.ts:157`, `rules/runtime/narrow.ts:43`) already route through `findSgBinary()`, so they need no change — they simply get a better answer, or a real error.
- **Kept**: `@ast-grep/cli` stays in the root `pnpm.onlyBuiltDependencies`, now permitting a script that runs only for contributors.
- **Related**: `add-vale-binary-packages` applies this same model to Vale. This change makes the two engines consistent, and lets one shared resolver serve both (`add-vale-rule-engine` task 5.1).
- **Behavioral risk**: platforms where no `@ast-grep/cli-<platform>` package exists — notably musl/Alpine — lose the wrapper's fallback path and rely on `PATH` alone.

**Tracking:** OSS-23
