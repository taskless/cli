## 1. Decide the distribution surface

- [x] 1.1 Enumerate Vale's published release assets for the pinned version and map them to npm `os`/`cpu` pairs; record the resulting architecture matrix (ast-grep's seven — win32 `arm64`/`ia32`/`x64`, darwin `arm64`/`x64`, linux `arm64-gnu`/`x64-gnu` — is the starting point, not the answer)
- [x] 1.2 Decide musl/Alpine: publish a musl variant or leave it on the `PATH` fallback. Note `findSgBinary()` maps every Linux to `-gnu` today, so ast-grep already falls through there
- [x] 1.3 Pin the Vale version the CLI expects, and write down the policy for tracking upstream releases (including expected turnaround for a Vale security release)

## 2. Package scaffolding

- [x] 2.1 Create `packages/vale-<platform>/` for each platform in the matrix: `package.json` with `name`, `version`, `os`, `cpu`, `files`, and `description` — **no `bin`, no `scripts`, no code**
- [x] 2.2 Add each package's `README.md` and the upstream Vale `LICENSE` (MIT) with attribution
- [x] 2.3 Gitignore the binary inside each package directory so a clean checkout stays binary-free
- [x] 2.4 Add the platform packages to `.changeset/config.json` `ignore`
- [x] 2.5 Confirm `pnpm-workspace.yaml`'s `packages/*` glob picks them up and `pnpm install` succeeds with the binaries absent

## 3. Checksums and fetch

- [x] 3.1 Commit a checksum manifest recording the SHA256 of each platform's upstream release asset for the pinned Vale version
- [x] 3.2 Write the fetch step: download each platform asset, verify against the committed checksum, fail loudly on mismatch, and unpack the executable into its package directory preserving the executable bit
- [x] 3.3 Ensure verification runs in a credential-free step, so no credentialed step handles unverified bytes
- [x] 3.4 Tests: a mismatched checksum aborts and publishes nothing; a matching one yields an executable file in the expected location

## 4. Version stamping

- [x] 4.1 Write the stamping step: set every platform package to `<valeVersion>-<yyyymmddhhmmss>` (UTC), identically across the set
- [x] 4.2 Assert the stamped version parses as a valid semver prerelease, that the timestamp is a numeric identifier with no leading zero, and that a plain `<valeVersion>` is never produced
- [x] 4.3 Tests: two runs produce ordered versions; the whole set shares one version; a caret range over the Vale version matches nothing

## 5. Release workflow

- [x] 5.1 Add a standalone workflow in two phases, no coupling to `release.yml`: **detect** — on a schedule, compare upstream Vale against what is published and open a PR updating the pinned version + checksums, publishing nothing; **publish** — on merge of that PR, run fetch → verify → stamp → pack → publish against the reviewed checksums
- [x] 5.2 Bound runs by the upstream comparison, not a published-version check — a fresh timestamp is never already on npm, so that check can never suppress a run
- [x] 5.3 Follow the existing hardening conventions: SHA-pinned action refs, no workflow-wide permission grants, no `${{ }}` interpolation of untrusted text into `run:`, OIDC trusted publishing bound to the `npm-production` environment, `--ignore-scripts` on install
- [x] 5.4 Verify an ordinary push to `main` publishes no platform package, and that a run with upstream unchanged publishes nothing

## 6. CLI wiring

- [x] 6.1 Add the platform packages to `packages/cli` `optionalDependencies` at literal exact versions — not `devDependencies` (never installed for consumers) and not `workspace:*` (would silently re-point at the newest stamp). Pinned at `3.17.1-20260810052605`; the lockfile records a registry resolution, not a workspace `link:`, which is what keeps the literal pin meaningful while the packages are also workspace members.
- [x] 6.2 Verify installing the CLI on a supported platform yields a resolvable binary from the CLI's module context, and that an unsupported platform installs cleanly with none present. `createRequire` from the CLI resolves `@taskless/vale-darwin-arm64/package.json`; the sibling `vale` is mode `755`, 37.7 MB, and reports `vale version 3.17.1`. Only the host-matching package installs — the other five are filtered by `os`/`cpu`.
- [x] 6.3 Confirm publishing a newer platform package leaves an unchanged CLI resolving its pinned version. Verified against two real published stamps: with `dist-tags.latest` at `3.17.1-20260810052605`, a project pinned to `3.17.1-20260810045147` installs `045147`. `^3.17.1` matches no version at all, so a range cannot float into a prerelease (D4).

## 7. Quality gates

- [x] 7.1 `pnpm typecheck && pnpm lint && pnpm test` clean at the repo root
- [x] 7.2 Dry-run the release workflow end to end without publishing, and confirm the packed tarball contains the executable with its permission bit
- [ ] 7.3 Once published, remove tasks 5.1b–5.1e from `add-vale-rule-engine`, which reduces to the runtime resolution (its task 5.1) alone. **Carried to `add-vale-rule-engine` (#71), the only branch where that file exists** — it is not present here, so this box cannot be ticked from this change. The precondition ("once published") is now met: all six packages are live at `3.17.1-20260810052605`.
