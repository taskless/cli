## 1. Confirm the upstream surface

- [ ] 1.1 Enumerate the published `@ast-grep/cli-<platform>` packages at the pinned ast-grep version and confirm each declares `os`/`cpu`, carries no `scripts` and no `bin`, and ships the executable with its permission bit
- [ ] 1.2 Determine whether upstream publishes musl variants and at which architectures (upstream's own `postinstall` uses `detect-libc`, implying they exist)
- [ ] 1.3 Confirm nothing in the repo — scripts, CI, or docs — invokes `sg`/`ast-grep` via the wrapper's `bin` entries rather than through `findSgBinary()`

## 2. Swap the dependency

- [ ] 2.1 Remove `@ast-grep/cli` from `packages/cli` dependencies
- [ ] 2.2 Add every `@ast-grep/cli-<platform>` package to `optionalDependencies`, all pinned to the same exact version, including musl variants if 1.2 found them
- [ ] 2.3 Reinstall and confirm the lockfile resolves only the host-matching package
- [ ] 2.4 Add a check that the platform set stays version-aligned, so an update cannot land partially applied

## 3. Verify resolution and execution

- [ ] 3.1 Confirm `findSgBinary()` resolves the platform package unchanged, and that `check`, `rule verify`, and the runtime narrow path (`rules/scan.ts:69`, `rules/verify.ts:157`, `rules/runtime/narrow.ts:43`) all still execute ast-grep
- [ ] 3.2 Verify under `pnpm dlx` that the resolved path is the real executable, not a placeholder — the failure `findSgBinary()`'s comment was written to route around
- [ ] 3.3 Verify with dependency lifecycle scripts disabled that the binary is present and every ast-grep-backed command runs
- [ ] 3.4 Verify on a platform with no published package that install succeeds and resolution falls back to `PATH`
- [ ] 3.5 Verify Alpine/musl behavior explicitly and record it — the wrapper's `.bin` shim may be load-bearing there today, so this is the one path that could regress

## 4. Clean up

- [ ] 4.1 Decide whether `buildPath()` (`rules/scan.ts:17-22`) still has a consumer once the `.bin/sg` shim is gone; remove it or document what still needs it
- [ ] 4.2 Remove any pnpm build-script approval for `@ast-grep/cli` that is no longer needed
- [ ] 4.3 Update comments in `rules/scan.ts` that describe routing around the wrapper's postinstall, which no longer applies once the wrapper is gone

## 5. Quality gates

- [ ] 5.1 `pnpm --filter @taskless/cli typecheck && lint && test` clean
- [ ] 5.2 Confirm the published CLI tarball declares the platform packages as optional dependencies at exact versions and does not declare `@ast-grep/cli`
