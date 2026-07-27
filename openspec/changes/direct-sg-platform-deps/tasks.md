## 1. Confirm the upstream surface

- [x] 1.1 Enumerate the published `@ast-grep/cli-<platform>` packages at the pinned ast-grep version and confirm each declares `os`/`cpu`, carries no `scripts` and no `bin`, and ships the executable with its permission bit — **seven at `0.41.0`**: darwin `x64`/`arm64`, linux `x64-gnu`/`arm64-gnu`, win32 `x64`/`ia32`/`arm64` msvc. Verified no `scripts`, no `bin`, MIT, and `ast-grep` at mode `-rwxr-xr-x`
- [x] 1.2 Determine whether upstream publishes musl variants — **it does not**, at `0.41.0` or `0.45.0`; the gnu packages declare `libc: ["glibc"]` so they are skipped on musl (D4)
- [x] 1.3 Confirm nothing invokes `sg`/`ast-grep` via the wrapper's `bin` entries — **nothing does**; all three call sites use `findSgBinary()`. But `scripts/fetch-ast-grep-schema.ts:19` reads `dependencies["@ast-grep/cli"]` for the schema tag and throws when absent, so it consumes the wrapper's _declaration_ and must move (2.3)

## 2. Remove the wrapper

- [ ] 2.1 Move `@ast-grep/cli` from `dependencies` to `devDependencies` — consumers stop installing it and its `postinstall` leaves the shipped product; `scripts/fetch-ast-grep-schema.ts` keeps its single version source
- [ ] 2.2 Tighten the seven platform declarations from `^0.41.0` to exactly `0.41.0` — held deliberately, not bumped to upstream's `0.45.0`, so this change stays purely structural (D2)
- [ ] 2.3 Update `scripts/fetch-ast-grep-schema.ts:19` to read from `devDependencies` instead of `dependencies`, and fail with a clear message naming the expected location
- [ ] 2.4 Leave `@ast-grep/cli` in the root `pnpm.onlyBuiltDependencies`; it now permits a script that runs only for contributors. Add a comment recording why it remains
- [ ] 2.5 Reinstall and confirm the lockfile resolves only the host-matching platform package, and that the wrapper is dev-only
- [ ] 2.6 Add a check that the platform set stays version-aligned and exactly pinned, so an update cannot land partially applied

## 2b. Exhaustive binary resolution

- [ ] 2b.1 Rewrite `findSgBinary()` to search candidates in order — platform package → `node_modules/.bin` → `sg` on `PATH` → `ast-grep` on `PATH` — returning the first that is an executable file
- [ ] 2b.2 Throw a clear error when every candidate misses, naming the locations tried; stop returning a bare `"sg"` for `spawn` to fail on
- [ ] 2b.3 Keep the shape reusable — `add-vale-rule-engine` extracts this into a helper shared with Vale, so candidate lists should be data, not control flow
- [ ] 2b.4 Tests: platform package wins over a `PATH` install; a `PATH` install is used when no platform package resolves; an exhausted search throws naming the locations

## 3. Verify resolution and execution

- [ ] 3.1 Confirm `findSgBinary()` resolves the platform package unchanged, and that `check`, `rule verify`, and the runtime narrow path (`rules/scan.ts:69`, `rules/verify.ts:157`, `rules/runtime/narrow.ts:43`) all still execute ast-grep
- [ ] 3.2 Verify under `pnpm dlx` that the resolved path is the real executable, not a placeholder — the failure `findSgBinary()`'s comment was written to route around
- [ ] 3.3 Verify with dependency lifecycle scripts disabled that the binary is present and every ast-grep-backed command runs
- [ ] 3.4 Verify on a platform with no published package that install succeeds and resolution falls back to `PATH`
- [ ] 3.5 Verify on a real Alpine image that the install now succeeds and resolution falls through to `PATH`. Per D4 this should be an improvement — today's `postinstall` exits 1 there — but confirm it rather than inferring from registry metadata

## 4. Clean up

- [ ] 4.1 Decide whether `buildPath()` (`rules/scan.ts:17-22`) still has a consumer once the `.bin/sg` shim is gone; remove it or document what still needs it
- [ ] 4.2 Remove any pnpm build-script approval for `@ast-grep/cli` that is no longer needed
- [ ] 4.3 Update comments in `rules/scan.ts` that describe routing around the wrapper's postinstall, which no longer applies once the wrapper is gone

## 5. Quality gates

- [ ] 5.1 `pnpm --filter @taskless/cli typecheck && lint && test` clean
- [ ] 5.2 Confirm the published CLI tarball declares the platform packages as optional dependencies at exact versions and does not declare `@ast-grep/cli`
