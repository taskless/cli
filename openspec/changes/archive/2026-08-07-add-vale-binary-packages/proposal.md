## Why

`add-vale-rule-engine` makes Vale a first-class rule engine, and a first-class engine cannot depend on the user having installed a binary themselves. The CLI already solves this for ast-grep — `findSgBinary()` (`packages/cli/src/rules/scan.ts:38-61`) resolves the platform-specific npm package from its own module context and execs the binary beside it — but there is no equivalent npm distribution of Vale to resolve. The only published one, `@vvago/vale`, is third-party and downloads the binary in a `postinstall`, which runs under the **consumer's** package-manager policy; pnpm 10 blocks dependency build scripts by default, so it yields no binary and no error.

This change produces the artifact the resolver needs: per-platform Vale binary packages, published from this repo, that require no lifecycle script to be usable.

## What Changes

- Add `packages/vale-<platform>/` workspace packages — one per supported platform — each carrying the Vale binary in its published tarball with `os`/`cpu` declared, and **no `bin`, no code, and no install scripts**.
- Binaries are **not committed to git**. Each package directory holds `package.json`, `README.md`, and `LICENSE` only; CI fetches the binary at release time and publishes a complete tarball.
- Version every platform package as an **all-prerelease timestamp**, `<valeVersion>-<yyyymmddhhmmss>` (e.g. `3.15.2-20260727120000`). A plain `<valeVersion>` is never published.
- Verify each fetched binary against a **committed, reviewed SHA256 checksum**; the publish job refuses a mismatch.
- Add a **standalone workflow** that watches upstream Vale and publishes when it is ahead of what the repository has packaged — independent of `release.yml`, which is left unchanged.
- Exclude the platform packages from changesets (`ignore`), since the workflow owns their versions.
- `packages/cli` declares the platform packages as `optionalDependencies` pinned to literal exact versions, so a newly published package is inert until the pin is deliberately bumped.

## Capabilities

### New Capabilities

- `vale-binary-packages`: Per-platform npm packages carrying the Vale binary — their contents and constraints (`os`/`cpu`, no scripts, no `bin`), the all-prerelease timestamp versioning scheme, checksum verification of fetched binaries, and the dedicated publish workflow.

### Modified Capabilities

- `infrastructure`: The changesets configuration excludes the workflow-versioned platform packages, so changesets neither versions nor publishes them.
- `cli`: The CLI declares the Vale platform packages as `optionalDependencies` pinned to literal exact versions, so the host-matching binary installs alongside it.

## Impact

- **New**: `packages/vale-<platform>/` (one per supported platform), a committed checksum manifest, and a GitHub Actions workflow that fetches, verifies, stamps, packs, and publishes.
- **Modified**: `.changeset/config.json` (`ignore` list), `packages/cli/package.json` (`optionalDependencies`). `.github/workflows/release.yml` is **not** modified — the platform packages do not route through it.
- **Not in scope**: the code that resolves and execs the binary. `findSgBinary()`'s generalization into a shared helper belongs to `add-vale-rule-engine`; this change only guarantees there is something for it to resolve.
- **Published artifacts are not reproducible from a plain `git clone`** — the binary is fetched at release time, not stored in the repository.
- **Supply chain**: the repository becomes a redistributor of a third-party binary. Vale is MIT, so redistribution requires attribution; the committed checksums keep "what can merge to `main`" as the trust boundary.

## Delivery shape

**Release impact: minor.** Adds per-platform binary packages and declares them as CLI `optionalDependencies`. Install gains a bundled binary — additive, but a change to what shipping the CLI actually delivers.

**Stacked, merging forward.** Publishing is inert until something pins it, which is what makes these units independently safe.

| Unit | Scope                                                         | Safe alone because                                    |
| ---- | ------------------------------------------------------------- | ----------------------------------------------------- |
| 1    | Package scaffolding, committed checksums, changesets `ignore` | Nothing published, nothing consumed — repository-only |
| 2    | Fetch, verify, stamp, and the two-phase release workflow      | Publishes packages no consumer references yet         |
| 3    | The CLI's `optionalDependencies` pin                          | The packages it pins already exist                    |

Unit 3 is the only one with user-visible effect, and it cannot precede unit 2 — reversing that order would pin a version that does not exist.
**Tracking:** OSS-22
