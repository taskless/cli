## Context

`packages/cli` depends on `@ast-grep/cli`. That package ships `sg`, `ast-grep`, and `postinstall.js`, and declares seven per-platform packages as `optionalDependencies` filtered by `os`/`cpu`. Its `postinstall` resolves the matching platform package and hardlinks (falling back to copy) the binary into itself, so its `bin: {sg, ast-grep}` entries resolve.

We never use those `bin` entries. Every ast-grep invocation in the CLI — `rules/scan.ts:69`, `rules/verify.ts:157`, `rules/runtime/narrow.ts:43` — calls `findSgBinary()` (`rules/scan.ts:38-61`), which does:

```
createRequire(import.meta.url).resolve('@ast-grep/cli-<platform>/package.json')
→ dirname → join(binary) → exec by path
```

falling back to `"sg"` on `PATH`. The platform package is already the primary resolution; the wrapper contributes only the fallback shim in `node_modules/.bin`, reached via `buildPath()` (`rules/scan.ts:17-22`).

Verified: `@ast-grep/cli-darwin-arm64` is independently published on npm, declares `os: [darwin]` / `cpu: [arm64]`, carries **no `scripts` and no `bin`**, is MIT, and ships `ast-grep` at mode `-rwxr-xr-x`. Only the host-matching package installs — this repo's store contains that one and no other.

The wrapper's install step has already failed here. `findSgBinary()`'s comment records the reason it was written: under `pnpm dlx`'s strict dependency isolation the hardlink cannot resolve, **leaving a placeholder text file instead of the real binary**. Separately, pnpm 10 does not run dependency lifecycle scripts without an `onlyBuiltDependencies` allowlist, so the wrapper's `postinstall` is subject to a policy set by whoever installs the CLI.

## Goals / Non-Goals

**Goals:** depend on the artifact we actually use; remove any dependence on a dependency lifecycle script; make ast-grep and Vale resolve through one model.

**Non-Goals:** changing how ast-grep is invoked or what it does; republishing ast-grep binaries ourselves (upstream already publishes exactly the packages we need); changing `findSgBinary()`'s resolution order.

## Decisions

### D1 — Depend on the platform packages directly; drop the wrapper

`packages/cli` declares the `@ast-grep/cli-<platform>` packages in `optionalDependencies` and removes `@ast-grep/cli`.

The wrapper exists to populate `bin` entries for human use. We exec by path, so its entire contribution is a shim we never call and an install-time step that has already proven fragile. Removing it means the binary is present purely by dependency resolution — nothing to approve, nothing a package-manager policy can block, no placeholder-file failure mode.

This is the same model `add-vale-binary-packages` adopts for Vale. There the work is publishing packages that don't exist; here upstream already publishes them, so the work is deleting a layer.

- **Alternative — keep the wrapper and rely on `findSgBinary()` to route around it:** rejected; that is today's arrangement, and it means carrying a dependency whose install step can fail in ways we then have to explain. The comment in `scan.ts` is the cost of that choice, already paid once.
- **Alternative — republish ast-grep binaries under our own scope:** rejected; upstream's platform packages are already script-free, `os`/`cpu`-filtered, and independently installable. Mirroring them would add a pipeline and a lag behind upstream for no gain. (Vale needs this only because no equivalent exists.)

### D2 — Pin every platform package to one exact ast-grep version

All platform packages are pinned to the same exact version and moved together. A mixed set would mean different hosts running different ast-grep versions against the same rules — a difference that would surface as inconsistent findings rather than as an install error.

The wrapper previously enforced this implicitly, by pinning its own `optionalDependencies` to its exact version. Declaring them directly moves that obligation to us, so it needs a check rather than a convention.

### D3 — Resolution order is unchanged; the fallback narrows

`findSgBinary()` keeps preferring the platform package and falling back to `"sg"`. What changes is only what the fallback can find: previously the wrapper's `node_modules/.bin/sg` shim **or** a host install; now a host install alone.

This matters exactly where the platform package is missing — an unsupported architecture, or musl (D4). It is a narrowing, so it deserves to be stated rather than discovered.

`buildPath()` exists to put `node_modules/.bin` on `PATH` for that shim. Whether it still earns its place once the shim is gone is an implementation question; it is harmless either way, and other tooling may rely on it.

### D4 — musl is an existing gap, neither widened nor closed here

`findSgBinary()` maps every Linux to `-gnu`, so on Alpine the resolve already misses and falls through to `PATH`. Upstream's own `postinstall` uses `detect-libc` and would have found a musl package.

So on musl the wrapper's shim may currently be doing real work, and removing it could turn a working setup into a `PATH`-dependent one. This change does not attempt to fix libc detection — that belongs with the shared resolver in `add-vale-rule-engine` — but it must confirm whether upstream publishes musl platform packages and, if so, include them, so the set is at least no worse than today.

## Risks / Trade-offs

- **musl/Alpine regression** (D4) → confirm whether upstream publishes musl platform packages; include them if so. Verify Alpine behavior explicitly rather than assuming, since the shim may be load-bearing there today.
- **Version drift across the platform set** (D2) → all pinned exactly and bumped together; add a check so an update cannot land partially applied.
- **Upstream reorganizes its platform packages** → we would be depending on packages upstream treats as an implementation detail of its wrapper, even though they are independently published and stable. Mitigated by exact pins: an upstream change cannot reach us until we bump. Worth noting as an ongoing, low-likelihood obligation.
- **Losing the `.bin` shim narrows the fallback** (D3) → accepted and documented; the primary path never used it.

## Migration Plan

Swap the dependency, reinstall, verify the binary resolves on a supported platform, and confirm `check`, `verify`, and the runtime narrow path all still run ast-grep. No on-disk or user-visible change; nothing to roll forward or back beyond the dependency itself.

Rollback is restoring the `@ast-grep/cli` dependency — `findSgBinary()` works under either arrangement, which is what makes this safe to try.

## Open Questions

- Does upstream publish musl platform packages, and at which architectures?
- Should this land before or after `add-vale-binary-packages`? They are independent, but doing this one first proves the model against packages that already exist, before the Vale change commits to publishing new ones.
- Does `buildPath()` still have a consumer once the `.bin/sg` shim is gone?
