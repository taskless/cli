## Context

The CLI shells out to engine binaries. For ast-grep this already works without depending on any install-time step: `findSgBinary()` (`packages/cli/src/rules/scan.ts:38-61`) calls `createRequire(import.meta.url).resolve('@ast-grep/cli-<platform>/package.json')`, execs the binary beside it, and falls back to `"sg"` on `PATH`. Its comment records why that indirection exists — `@ast-grep/cli`'s `postinstall` hardlink **breaks under `pnpm dlx`'s strict dependency isolation, leaving a placeholder text file** where the binary should be.

Verified facts that shape this design:

- `@ast-grep/cli-darwin-arm64` ships `ast-grep` at mode `-rwxr-xr-x` (46 MB): **the executable bit survives an npm tarball**, so nothing needs to `chmod` at install time.
- Only the host-matching platform package installs — `optionalDependencies` plus `os`/`cpu` filtering (this repo's store contains `@ast-grep+cli-darwin-arm64` and no other).
- Upstream ast-grep still needs its `postinstall` because it exposes `bin: {sg, ast-grep}` for humans; the script only hardlinks the platform binary into the main package so those `bin` entries work.

There is no equivalent Vale distribution to resolve. The one published package, `@vvago/vale` (maintainer `zeropaper`, not the Vale project), ships an empty package plus a `postinstall` that downloads the release archive.

`release.yml` is deliberately hardened: a credential-free `version` job consumes untrusted changeset text, a credential-free `check` job decides whether to publish, and only then does a `publish` job exist with OIDC and the `npm-production` environment. Its header states the trust boundary explicitly — "what can merge to main". Any binary fetching must preserve that property.

## Goals / Non-Goals

**Goals:** produce per-platform Vale packages the existing resolver pattern can find; require **no lifecycle script** anywhere in the chain; keep the Vale version legible in the package version; make wrong-version resolution impossible rather than merely discouraged; keep the trust boundary at code review.

**Non-Goals:** the resolution/exec code itself (that is `add-vale-rule-engine`); generating Vale rules; committing binaries to this repository; supporting arbitrary Vale versions simultaneously.

## Decisions

### D1 — Packages live in this repo, published to the Taskless scope

`packages/vale-<platform>/`, published alongside `@taskless/cli`. npm scope ownership and the OIDC trusted-publisher binding stay in one place, and the consumer of these packages is in the same workspace.

- **Alternative — a separate repository:** rejected; it would need its own npm publish identity and trusted-publisher configuration for what is a sibling artifact of the CLI, and version coordination would cross a repo boundary.

### D2 — ast-grep's packaging, without ast-grep's installation

Each package contains the Vale binary, a `package.json` declaring `os`/`cpu`, a `README`, and Vale's MIT `LICENSE`. **No `bin`, no code, no scripts.**

We exec Vale by explicit path, so nothing needs hardlinking into the consuming package — the entire reason upstream ast-grep runs a `postinstall`. Dropping it removes the failure mode this repo already hit under `pnpm dlx`, and means no package-manager script policy can prevent the binary from being present.

- **Alternative — depend on `@vvago/vale`:** rejected. Its `postinstall` executes during a **consumer's** install, under a policy we cannot set; pnpm 10 blocks dependency build scripts without an `onlyBuiltDependencies` allowlist, producing no binary and no error. The download also carries no npm integrity guarantee and fails behind proxies and offline mirrors. The same objection would apply if the Vale project published it.
- **Alternative — download at runtime into `node_modules`:** rejected. The canonical invocation is `npx @taskless/cli`, so the install is ephemeral and the binary would be re-fetched on essentially every run; writing into `node_modules` is also unsafe where pnpm's content-addressable store is hard-linked into unrelated projects.

### D3 — Binaries are fetched at release time, never committed

Seven platforms at roughly 10–20 MB each would live in git history permanently. The package directories are source-only and gitignore the binary; the release pipeline places it before packing.

**Stated plainly: a published tarball is not reproducible from a plain `git clone`.** Reproducing one requires re-running the fetch against the pinned upstream release. The committed checksums (D6) are what make that reproduction verifiable.

- **Alternative — commit the binaries:** rejected on permanent repository weight.
- **Alternative — Git LFS:** rejected; adds a hosting dependency and a clone-time requirement for every contributor, to solve a problem the release pipeline already handles.

### D4 — All-prerelease timestamp versioning

Every platform package is versioned `<valeVersion>-<yyyymmddhhmmss>` — e.g. `3.15.2-20260727120000`. **A plain `<valeVersion>` is never published.**

Four properties, each load-bearing:

1. **Provenance stays legible.** The upstream Vale version is the leading component, readable without opening the package.
2. **No version is ever spent.** A packaging fix against the same upstream Vale is a new timestamp on the same base. Mirroring upstream exactly (`3.15.2` ⇒ Vale 3.15.2) has no such escape hatch, and the obvious one is invalid: `3.15.2-taskless.1` is a _prerelease_ and sorts **before** `3.15.2`.
3. **Exact pinning is enforced by semver, not convention.** A prerelease satisfies a range only when the range names the same `major.minor.patch` with a prerelease, so `^3.15.2` cannot match `3.15.2-20260727120000`. A consumer physically cannot float across versions.
4. **Timestamps order correctly.** `20260727120000` is a valid numeric identifier — no leading zero, ~2×10¹³, inside safe-integer range — so prerelease comparison is numeric and monotonic.

- **Alternative — independent semver with `valeVersion` as metadata:** rejected; solves (2) but discards (1) and (3).
- **Alternative — mirror upstream exactly:** rejected per (2).

### D5 — Platform packages bypass the release flow entirely

Changesets bumps semver by release type and its pre-mode emits counters (`-next.0`), not timestamps; it cannot express D4. The platform packages go in `.changeset/config.json` `ignore`, and a workflow owns their versions. **Two version systems in one repository, deliberately** — changesets for `@taskless/cli`, a timestamp stamp for the platform packages.

They do not participate in `release.yml` at all. A standalone workflow watches upstream Vale on a schedule and acts in **two phases**, which is what reconciles automation with the reviewed-checksum boundary in D6:

1. **Detect (unattended).** When upstream publishes a release the repository has not packaged, the workflow opens a pull request updating the pinned Vale version and the committed checksums. It publishes nothing.
2. **Publish (on merge).** Merging that pull request triggers the fetch → verify → stamp → pack → publish run. The checksums it verifies against are the ones just reviewed.

Nobody has to notice a Vale release, and nothing is published on bytes a human has not signed off on. A single-phase "detect and publish" workflow cannot have both — it would either skip verification or verify against a digest it discovered itself, which verifies nothing.

Safe to automate because **publishing a platform package changes nothing on its own** — the CLI pins an exact version (D8), so a newly published package is inert until someone bumps that pin. Two independent gates, then: review to publish the package, and a separate deliberate bump to adopt it.

This also avoids a trap: a freshly stamped timestamp is never already on npm, so any "is this version published?" check would fire on every run. The upstream-version comparison, not a published-version check, is what bounds releases.

- **Alternative — route these through `release.yml`:** rejected; it is built around changesets and a published-version check, neither of which applies here, and coupling them would mean a Vale release could not ship without a CLI release.

### D6 — Committed checksums are the trust boundary

The SHA256 of each platform's upstream release asset is committed to the repository and reviewed like any other change. The publish pipeline verifies every fetched binary against it and refuses a mismatch.

This preserves what `release.yml`'s header claims: the real perimeter is "what can merge to main". Fetching an unverified third-party binary inside a job holding an OIDC identity would move that perimeter to "whatever the upstream host served today". Verification should also happen in a **credential-free** step, so the credentialed job only ever handles bytes that already matched a reviewed digest.

### D7 — `release.yml` is left alone; the publishing identity is inherited

Because the platform packages never route through `release.yml` (D5), its `check` job reading `packages/cli/package.json` stays correct — the CLI remains the only package it publishes.

Recorded rather than fixed: that check is hardcoded, so any _future_ package that did expect to ride the release flow would be invisible to it. Not a problem this change creates, and not one it needs to solve.

The publishing security model is inherited, not reinvented. The platform-package workflow authenticates through the repository's existing npm trusted publishing — a short-lived OIDC-minted token bound to the `npm-production` environment, with no stored registry token — and follows the same hardening conventions (SHA-pinned actions, no workflow-wide permission grants, no interpolation of untrusted text into `run:`, `--ignore-scripts` on install).

That arrangement was established directly on `main` and is **not currently described by any spec** — `openspec/specs/` contains no requirement covering `release.yml`, OIDC, or trusted publishing. This change does not backfill that; it states the dependency so the new workflow is understood to sit inside the existing perimeter rather than beside it.

### D8 — The CLI pins an exact version by hand

`packages/cli` declares each platform package in `optionalDependencies` at a literal exact version. Given D4, no range syntax could resolve them anyway; the literal makes the intent explicit and the pin greppable.

`optionalDependencies` specifically, not `devDependencies`: a devDependency is not installed for anyone consuming `@taskless/cli`, so the binary would reach contributors to this repository and no one else. `optional` is what lets an unsupported platform install the CLI cleanly with no platform package present.

The pin is **not** `workspace:*`. Under D5 the platform packages are versioned by a workflow on upstream Vale's cadence, so a workspace protocol would silently re-point the CLI at whatever was stamped most recently. A literal version means a newly published platform package is inert until someone deliberately bumps the CLI — which is what makes the automatic publish workflow safe to run unattended.

- **Alternative — `workspace:*` rewritten at publish:** rejected; it couples the CLI's shipped Vale version to release timing rather than to a reviewed decision.

## Risks / Trade-offs

- **Published tarballs are not reproducible from a clone** (D3) → committed checksums make reproduction verifiable; the fetch is pinned to a specific upstream release.
- **The repo becomes a redistributor of a third-party binary** → Vale is MIT; each package ships the upstream `LICENSE` and attribution. Upstream security fixes require us to re-publish, so tracking Vale releases becomes an ongoing obligation rather than a one-time task.
- **Two version systems in one repository** (D5) → confined to the `ignore` list plus one release script; `@taskless/cli` keeps its normal changesets flow untouched.
- **Timestamp versions read as noise** in `npm view` history → accepted; they are machine-pinned and never hand-typed.
- **A platform without a published package silently falls back to `PATH`** → the resolver reports the engine unavailable rather than failing the run (`add-vale-rule-engine` D6), but the degradation is quiet. The architecture matrix should be chosen to cover the realistic deployment surface, not the minimum.
- **Install weight grows** → one platform binary per install, in the range ast-grep's 46 MB already established as acceptable here.

## Migration Plan

Purely additive. The packages can be published before anything consumes them; the CLI gains `optionalDependencies` only once they exist. Nothing in the CLI's current behavior changes until `add-vale-rule-engine` adds the resolver, and that change degrades cleanly when no package resolves.

Rollback is deprecation of a published version plus reverting the CLI's pin — no consumer state to unwind.

## Open Questions

- **Architecture matrix.** ast-grep's seven (win32 `arm64`/`ia32`/`x64`, darwin `arm64`/`x64`, linux `arm64-gnu`/`x64-gnu`) is the starting point, but Vale's published release assets decide what is actually available.
- **musl / Alpine.** Publish a musl variant, or leave it on the `PATH` fallback? Note `findSgBinary()` maps every Linux to `-gnu` today, so Alpine already falls through for ast-grep — this is an existing gap, not a new one.
- **Which Vale version the CLI pins**, and the policy for tracking upstream releases (including how quickly a Vale security release must be mirrored).
