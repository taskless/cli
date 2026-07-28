## 1. Confirm the upstream surface

- [x] 1.1 Enumerate the published `@ast-grep/cli-<platform>` packages at the pinned ast-grep version and confirm each declares `os`/`cpu`, carries no `scripts` and no `bin`, and ships the executable with its permission bit — **seven at `0.41.0`**: darwin `x64`/`arm64`, linux `x64-gnu`/`arm64-gnu`, win32 `x64`/`ia32`/`arm64` msvc. Verified no `scripts`, no `bin`, MIT, and `ast-grep` at mode `-rwxr-xr-x`
- [x] 1.2 Determine whether upstream publishes musl variants — **it does not**, at `0.41.0` or `0.45.0`; the gnu packages declare `libc: ["glibc"]` so they are skipped on musl (D4)
- [x] 1.3 Confirm nothing invokes `sg`/`ast-grep` via the wrapper's `bin` entries — **nothing does**; all three call sites use `findSgBinary()`. But `scripts/fetch-ast-grep-schema.ts:19` reads `dependencies["@ast-grep/cli"]` for the schema tag and throws when absent, so it consumes the wrapper's _declaration_ and must move (2.3)

## 2. Remove the wrapper

- [x] 2.1 Move `@ast-grep/cli` from `dependencies` to `devDependencies` — consumers stop installing it and its `postinstall` leaves the shipped product; `scripts/fetch-ast-grep-schema.ts` keeps its single version source
- [x] 2.2 Tighten the seven platform declarations from `^0.41.0` to exactly `0.41.0` — held deliberately, not bumped to upstream's `0.45.0`, so this change stays purely structural (D2)
- [x] 2.3 Update `scripts/fetch-ast-grep-schema.ts:19` to read from `devDependencies` instead of `dependencies`, and fail with a clear message naming the expected location
- [x] 2.4 Leave `@ast-grep/cli` in the root `pnpm.onlyBuiltDependencies` — done; it now permits a script that runs only for contributors. The "add a comment" half is **not possible**: the allowlist lives in `package.json`, which cannot carry comments. Rationale is recorded in this change's design (D1) instead
- [x] 2.5 Reinstall and confirm the lockfile resolves only the host-matching platform package, and that the wrapper is dev-only
- [x] 2.6 Add a check that the platform set stays version-aligned and exactly pinned — `test/sg-binary.test.ts` asserts every platform package shares one exact version, that the wrapper is absent from `dependencies`/`optionalDependencies`, and that the devDependency matches the shipped binaries

## 2b. Exhaustive binary resolution

- [x] 2b.1 Rewrite `findSgBinary()` to search candidates in order — platform package → `node_modules/.bin` → `sg` on `PATH` → `ast-grep` on `PATH` — returning the first that is an executable file
- [x] 2b.2 Throw a clear error when every candidate misses, naming the locations tried; stop returning a bare `"sg"` for `spawn` to fail on
- [x] 2b.3 Keep the shape reusable — `add-vale-rule-engine` extracts this into a helper shared with Vale, so candidate lists should be data, not control flow
- [x] 2b.4 Tests: `test/sg-binary.test.ts` covers the platform package winning over a decoy `sg` on `PATH`, resolution returning an absolute path, and resolution surviving an empty `PATH`. **Not unit-tested:** the `PATH`-fallback and exhausted-search branches, because the platform package always resolves in this workspace — reaching them needs module mocking. The no-platform-package case is covered end-to-end by the Alpine verification in 3.5

## 3. Verify resolution and execution

- [x] 3.1 Confirm `findSgBinary()` resolves the platform package unchanged, and that `check`, `rule verify`, and the runtime narrow path (`rules/scan.ts:69`, `rules/verify.ts:157`, `rules/runtime/narrow.ts:43`) all still execute ast-grep
- [ ] 3.2 Verify under `pnpm dlx` that the resolved path is the real executable, not a placeholder — needs a published build to `dlx` against, so it lands after release rather than in this change
- [x] 3.3 Verify with dependency lifecycle scripts disabled that the binary is present — covered by 3.5's Alpine run, where the platform packages install with no lifecycle script involved at all
- [x] 3.4 Verify on a platform with no published package that install succeeds and resolution falls back to `PATH`
- [x] 3.5 Verify on a real Alpine image that the install now succeeds and resolution falls through to `PATH` — **confirmed on `node:22-alpine` (musl, aarch64)**. With the platform packages as `optionalDependencies`, `npm install` exits 0 and installs no `@ast-grep/*` package (`libc` filtering skips the gnu builds). With the wrapper as a hard dependency, `npm install` exits **1**: "Failed to move @ast-grep/cli binary into place." Both halves of D4 verified empirically, not inferred from registry metadata

## 4. Clean up

- [x] 4.1 Decide whether `buildPath()` still has a consumer once the `.bin/sg` shim is gone — **kept**. It no longer participates in locating ast-grep (resolution returns an absolute path), but it still shapes the environment of processes we spawn, which is a separate concern. Documented as such in `rules/scan.ts`
- [x] 4.2 Remove any pnpm build-script approval for `@ast-grep/cli` that is no longer needed — **kept**; the wrapper remains a `devDependency` for the schema script, so its `postinstall` still runs for contributors. It no longer runs for consumers, which is the point
- [x] 4.3 Update comments in `rules/scan.ts` that describe routing around the wrapper's postinstall

## 5. Quality gates

- [x] 5.1 `pnpm --filter @taskless/cli typecheck && lint && test` clean
- [ ] 5.2 Confirm the published CLI tarball declares the platform packages as optional dependencies at exact versions and does not declare `@ast-grep/cli` — asserted against `package.json` in `test/sg-binary.test.ts`; confirm against a real `npm pack` at release time
