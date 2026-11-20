Groups 1–3 are PR A, cut from `origin/main`. Group 4 is the maintainer's manual step between the two landings. Groups 5–8 are PR B, cut from #703's head and targeting `main`; it archives this change.

## 1. Manifest and grammar package (PR A)

- [x] 1.1 Add a `grammars` section to `.github/scripts/vale-manifest.json` (package, directory, asset template `grammar-{name}.zip`, archive member `grammar-{name}/styles/config/grammars/{name}.wasm`, one `{ name, sha256 }` per upstream grammar for 3.27.0, taken from GitHub's recorded asset digests), and extend the manifest comment to say upstream's checksums file does not cover these digests; verify every digest by re-downloading the 22 assets and comparing `shasum -a 256`.
- [x] 1.2 Create `packages/vale-grammars/` with `package.json` (no `os`/`cpu`, no `bin`, no `scripts`, placeholder version `0.0.0`, `files: ["grammars"]`), `README.md`, and upstream `LICENSE`; ignore `packages/vale-grammars/grammars/` in git and add the package to the changesets `ignore` list; verify `git status` stays clean after a prepare run.
- [x] 1.3 Extend the pure functions in `vale-release.cjs` (manifest validation, stamping, digest comparison) to cover the grammar section; verify with new cases in `vale-release.test.cjs` under `node --test`.

## 2. Pipeline (PR A)

- [x] 2.1 `vale-prepare.cjs`: download each grammar archive, verify it against its committed digest, stream only the named member with `unzip -p`, require the WebAssembly magic, write it to `grammars/<name>.wasm`, stamp, and `npm pack` beside the six platform tarballs; accept `--only grammars` and `--version <stamped>` for the bootstrap; verify locally that `--only grammars --version 3.27.0-20261117230017` yields one tarball listing 22 `.wasm` files at that version.
- [x] 2.2 `vale-detect.cjs`: when upstream moves, read the release's `grammar-*.zip` assets and their GitHub-recorded digests, and rewrite the grammar list and digests in the manifest pull request; verify with `vale-detect.test.cjs` cases for a rewritten grammar list and an asset with no digest.
- [x] 2.3 `vale-gate.cjs`: report "already published" only when the platform packages and `@taskless/vale-grammars` both have a version for the pinned Vale release; verify with `vale-gate.test.cjs` cases for grammars missing, binaries missing, and both present.
- [x] 2.4 `vale-upgrade-detect.cjs` and `vale-upgrade-wait.cjs`: confirm the grammar package joins the pinned set through the existing `@taskless/vale-*` prefix, and document it; verify with `vale-upgrade-detect.test.cjs` cases where a grammar pin moves with the platform pins, and where a grammar package published at a different version blocks the upgrade.
- [x] 2.5 `release-vale.yml` and `vale-upgrade.yml`: update the header comments and any step that names "six" packages; confirm the workflow filename, workflow name, and `environment:` are unchanged (the OIDC binding); verify with `pnpm lint` (actionlint).

## 3. PR A checks

- [x] 3.1 Run `pnpm typecheck`, `pnpm lint`, and `node --test .github/scripts/` and confirm they pass; open PR A to `main` with the `skip-changeset` label and request `@claude /review`.

## 4. Bootstrap (maintainer, between PR A and PR B)

- [x] 4.1 Run `node .github/scripts/vale-prepare.cjs --only grammars --version 3.27.0-20261117230017` on PR A's branch, publish that tarball by hand with `npm publish --access public --tag latest`, and register its npm trusted publisher against `release-vale.yml` and `npm-autopublish`; verify `npm view @taskless/vale-grammars version` prints `3.27.0-20261117230017`.
- [x] 4.2 Confirm `vale-gate.cjs`, run against PR A's manifest and the live registry, reports all seven packages published, so merging PR A publishes nothing.

## 5. CLI wiring (PR B)

- [x] 5.1 Add `@taskless/vale-grammars` to `packages/cli/package.json` `dependencies` at the same exact version as the six platform pins, and regenerate `pnpm-lock.yaml`; verify with `pnpm install --frozen-lockfile`.
- [x] 5.2 Add the grammar resolver beside `findValeBinary` (spec, per-process cache, miss as `{ path: undefined, tried }`); verify with unit tests for a resolved package and a missing one.
- [x] 5.3 Set `VALE_GRAMMARS_PATH` in `spawnVale`'s child environment when the resolver returns a path; verify that the six #703 vendor-contract failures pass with no `VALE_GRAMMARS_PATH` in the test shell.
- [x] 5.4 Export the grammar spec and resolver from `src/node/runtimes/index.ts` with a note in the entry's documentation; verify the build's export classification passes and `dist/node/runtimes/index.d.ts` declares both.

## 6. Refusal and coverage (PR B)

- [x] 6.1 Refuse a `<rules tree>/config/grammars/` directory through one shared check under a new `vale-tree-no-grammars` constraint, reported by `validate` against every Vale rule and by assembly as a tree-level refusal `check` reports; verify with tests for the `validate` failure, the `check` failure with non-zero exit and ast-grep results still reported, and an empty directory.
- [x] 6.2 Add the D6 coverage case to `test/vale-vendor-contract.test.ts`: every comment-tier extension in `VALE_FORMAT_TIERS`, run with the pinned grammars, produces no `grammar "<name>" is not installed` warning; verify it fails when one grammar is withheld and passes with the full set.
- [x] 6.3 Extend `engine-version-consistency.test.ts` so the grammar pin is the same exact version as the platform pins and its Vale component equals `VALE_VERSION`; verify it fails on a mismatched pin.

## 7. Release notes (PR B)

- [x] 7.1 Add the Vale 3.27.0 entry to the `update` ledger in `src/agent/update.md`, stating that behavior is unchanged and that a `.taskless/rules/vale/config/grammars/` directory is now refused; verify the reconcile-marker and prompt parity tests pass.
- [x] 7.2 Grow `.changeset/vale-3-27-0.md` (patch) to say the grammars ship as their own package and an unvetted grammar directory in the rules tree is refused; verify the `Changeset` check stays green.

## 8. PR B checks and archive

- [x] 8.1 Run `pnpm build`, `pnpm typecheck`, `pnpm lint`, and the full CLI suite and confirm they pass on every branch of PR B.
- [x] 8.2 Archive with `pnpm openspec archive vale-grammars-package -y` after confirming every prior scenario in the three standing specs survives (the pre-archive check in AGENTS.md); open PR B to `main` with `Refs #703` and request `@claude /review`.
