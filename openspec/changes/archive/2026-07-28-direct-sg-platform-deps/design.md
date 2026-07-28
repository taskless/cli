## Context

**Current state, verified:** `packages/cli` already declares all seven `@ast-grep/cli-<platform>` packages in `optionalDependencies` — at caret ranges (`^0.41.0`) — _and_ still depends on `@ast-grep/cli` itself. The migration was started and not finished.

The wrapper ships `sg`, `ast-grep`, and `postinstall.js`, and declares the same seven packages as its own `optionalDependencies` filtered by `os`/`cpu`. Its `postinstall` resolves the matching platform package and hardlinks (falling back to copy) the binary into itself, so its `bin: {sg, ast-grep}` entries resolve. Running that script required an opt-in: the root `package.json` lists `@ast-grep/cli` in `pnpm.onlyBuiltDependencies`, alongside `esbuild`.

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

### D1 — Remove the wrapper; the platform packages are already declared

The platform packages stay as they are; `@ast-grep/cli` is removed.

The wrapper exists to populate `bin` entries for human use. We exec by path, so its entire contribution is a shim we never call plus an install-time step that has already proven fragile. With the platform packages already declared, removing it leaves the binary present purely by dependency resolution — nothing to approve, nothing a package-manager policy can block, no placeholder-file failure mode, and one less allowlist entry.

This is the same model `add-vale-binary-packages` adopts for Vale. There the work is publishing packages that do not exist; here upstream already publishes them and we already depend on them, so the work is deleting a layer.

One consumer of the wrapper's _declaration_ — not its binary — keeps it alive, but only for us: `scripts/fetch-ast-grep-schema.ts:19` reads `dependencies["@ast-grep/cli"]` to choose which upstream tag to fetch the rule schema from. That is a build-time need, so `@ast-grep/cli` **moves to `devDependencies`** rather than disappearing.

Consequences of that placement, both intended:

- Consumers of `@taskless/cli` never install it, so the wrapper's `postinstall` — and the `pnpm dlx` failure mode — leave the shipped product entirely. The fragility is confined to this repository's own installs.
- The root `pnpm.onlyBuiltDependencies` entry for `@ast-grep/cli` therefore stays. It now permits a script that only ever runs for contributors.

- **Alternative — remove the wrapper outright and read the version from a platform package:** viable and would drop the allowlist entry too, but it spreads the schema script's version source across seven declarations to avoid a devDependency that costs consumers nothing.

- **Alternative — keep the wrapper and rely on `findSgBinary()` to route around it:** rejected; that is today's arrangement, and it means carrying a dependency whose install step can fail in ways we then have to explain. The comment in `scan.ts` is the cost of that choice, already paid once.
- **Alternative — republish ast-grep binaries under our own scope:** rejected; upstream's platform packages are already script-free, `os`/`cpu`-filtered, and independently installable. Mirroring them would add a pipeline and a lag behind upstream for no gain. (Vale needs this only because no equivalent exists.)

### D2 — Pin every platform package to one exact ast-grep version

They are currently declared at caret ranges (`^0.41.0`), which permits different hosts resolving different ast-grep versions against the same rules — a divergence that surfaces as inconsistent findings, not as an install error. Upstream has since published `0.45.0`, so the ranges are live, not theoretical.

The wrapper enforced alignment implicitly today, by pinning its own `optionalDependencies` to its exact version — one more thing lost when it leaves the runtime dependency set, and the reason exact pins belong in this change rather than a later one. Because that alignment stops being structural, it needs a check rather than a convention.

**The pin holds at `0.41.0`.** Upstream is at `0.45.0`, and taking it here would be free-riding on a structural change: if ast-grep's behavior shifted, nobody could tell whether this change or the version caused it. Holding keeps the swap independently verifiable — findings before and after must be identical. Bumping to `0.45.0` is worth doing, as its own small change where a behavior difference has exactly one candidate explanation.

### D3 — Resolution exhausts every known location, then fails clearly

Today `findSgBinary()` returns the literal string `"sg"` when the platform package does not resolve, and the failure surfaces later as a spawn error — from a caller that cannot say where it looked.

Resolution becomes an ordered search over candidate locations, each checked for an actual executable:

1. the host's `@ast-grep/cli-<platform>` package (the normal case),
2. `node_modules/.bin`, for a host that still has the wrapper or another provider,
3. `sg`, then `ast-grep`, on `PATH`.

If every candidate misses, resolution **fails with an error naming the locations it tried**. There is no ast-grep, and saying so plainly beats handing a bare `"sg"` to `spawn` and letting `ENOENT` explain it.

The ordering is the point: these are best-guess locations tried in descending confidence, not a chain where a later entry is a lesser version of an earlier one. A bundled platform package is preferred over a host install because it is the version we pinned; a host install is still better than nothing.

This is also the shape `add-vale-rule-engine` needs for Vale — platform package, then `PATH`, then a clear unavailable report — which is what makes one shared helper serve both engines.

`buildPath()` puts `node_modules/.bin` on `PATH` for spawned processes; candidate (2) makes that location explicit in the search rather than implicit in the environment. Whether `buildPath()` still earns its place is an implementation question, and it is harmless either way.

### D4 — musl improves; there is no musl package to lose

Verified against the registry, so this replaces the concern that dropping the wrapper might regress Alpine:

- **No musl package exists.** `@ast-grep/cli` publishes exactly seven platform packages at `0.41.0`, and the same seven at `0.45.0` — darwin `x64`/`arm64`, linux `x64-gnu`/`arm64-gnu`, win32 `x64`/`ia32`/`arm64` msvc. `@ast-grep/cli-linux-x64-musl` and `-linux-arm64-musl` are unpublished.
- **The gnu packages declare `libc: ["glibc"]`**, so a package manager skips them on musl rather than installing a binary that cannot exec.

Upstream's `postinstall` uses `detect-libc` and therefore computes `@ast-grep/cli-linux-x64-musl` on Alpine — a package that does not exist. It falls back to `target/release`, then `target/debug` (neither present in a published package), then `console.error` and `exit 1`. **Today, wherever dependency scripts actually run, installing on Alpine fails.**

After this change there is no script, so the install succeeds with no platform package present and `findSgBinary()` falls through to `PATH`. Alpine goes from a failed install to a clean install plus a documented fallback.

`findSgBinary()` mapping every Linux to `-gnu` is consequently harmless: on glibc it names the package that exists, and on musl `libc` filtering has already ensured nothing is installed to resolve. Fixing libc detection would be correctness for its own sake — worth doing with the shared resolver in `add-vale-rule-engine`, not required here.

## Risks / Trade-offs

- ~~musl/Alpine regression~~ → **resolved, and it improves** (D4): no musl package exists at any version, the gnu packages declare `libc: ["glibc"]` so they are skipped there, and today's wrapper `postinstall` actively fails the install on Alpine. Still worth verifying once on a real Alpine image rather than reasoning from metadata alone.
- **Version drift across the platform set** (D2) → all pinned exactly and bumped together; add a check so an update cannot land partially applied.
- **Upstream reorganizes its platform packages** → we would be depending on packages upstream treats as an implementation detail of its wrapper, even though they are independently published and stable. Mitigated by exact pins: an upstream change cannot reach us until we bump. Worth noting as an ongoing, low-likelihood obligation.
- **Losing the `.bin` shim narrows the fallback** (D3) → accepted and documented; the primary path never used it.

## Migration Plan

Swap the dependency, reinstall, verify the binary resolves on a supported platform, and confirm `check`, `verify`, and the runtime narrow path all still run ast-grep. No on-disk or user-visible change; nothing to roll forward or back beyond the dependency itself.

Rollback is restoring the `@ast-grep/cli` dependency — `findSgBinary()` works under either arrangement, which is what makes this safe to try.

## Open Questions

- Should this land before or after `add-vale-binary-packages`? They are independent, but doing this one first proves the model against packages that already exist, before the Vale change commits to publishing new ones.
- Does `buildPath()` still have a consumer once the `.bin/sg` shim is gone?
- Should the ast-grep version be bumped (`0.41.0` → `0.45.0`) while touching these pins, or held constant to keep this change purely structural? Holding it constant makes the swap independently verifiable.

**Resolved:** upstream publishes no musl packages at any version, and the gnu packages declare `libc` (D4).
