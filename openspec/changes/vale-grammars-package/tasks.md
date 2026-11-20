Groups 1–3 are PR A, cut from `origin/main`. Group 4 is the maintainer's manual step between the two landings. Groups 5–8 are PR B, cut from #703's head and targeting `main`; it archives this change.

## 1. Manifest and grammar package (PR A)

- [ ] 1.1 Add a `grammars` section to `.github/scripts/vale-manifest.json` (package, directory, asset template `grammar-{name}.zip`, archive member `styles/config/grammars/{name}.wasm`, one `{ name, sha256 }` per upstream grammar for 3.27.0), and extend the manifest comment to say upstream's checksums file does not cover these digests; verify every digest by re-downloading the 22 assets and comparing `shasum -a 256`.
- [ ] 1.2 Create `packages/vale-grammars/` with `package.json` (no `os`/`cpu`, no `bin`, no `scripts`, placeholder version `0.0.0`, `files: ["grammars"]`), `README.md`, and upstream `LICENSE`; ignore `packages/vale-grammars/grammars/` in git and add the package to the changesets `ignore` list; verify `git status` stays clean after a prepare run.
- [ ] 1.3 Extend the pure functions in `vale-release.cjs` (manifest validation, stamping, digest comparison) to cover the grammar section; verify with new cases in `vale-release.test.cjs` under `node --test`.

## 2. Pipeline (PR A)

- [ ] 2.1 `vale-prepare.cjs`: download each grammar archive, verify it against its committed digest before unzipping, extract only the named member flattened to `grammars/<name>.wasm`, stamp at the run's version, and `npm pack` beside the six platform tarballs; verify locally that `--out` yields seven tarballs and the grammar tarball lists 22 `.wasm` files.
- [ ] 2.2 `vale-detect.cjs`: when upstream moves, list the release's `grammar-*.zip` assets, download and hash each, and rewrite the grammar list and digests in the manifest pull request; verify with `vale-detect.test.cjs` cases for an added, a removed, and an unchanged grammar.
- [ ] 2.3 `vale-gate.cjs`: report "already published" only when the platform packages and `@taskless/vale-grammars` both have a version for the pinned Vale release; verify with `vale-gate.test.cjs` cases for grammars missing, binaries missing, and both present.
- [ ] 2.4 `vale-upgrade-detect.cjs` and `vale-upgrade-wait.cjs`: treat the grammar package as a member of the set, wait for all seven, and move the CLI's grammar pin with the six platform pins; verify with their `.test.cjs` suites, including the case where binaries are published and grammars are not.
- [ ] 2.5 `release-vale.yml` and `vale-upgrade.yml`: update the header comments and any step that names "six" packages; confirm the workflow filename, workflow name, and `environment:` are unchanged (the OIDC binding); verify with `pnpm lint` (actionlint).

## 3. PR A checks

- [ ] 3.1 Run `pnpm typecheck`, `pnpm lint`, and `node --test .github/scripts/` and confirm they pass; open PR A to `main` with the `skip-changeset` label and request `@claude /review`.

## 4. Bootstrap (maintainer, between PR A and PR B)

- [ ] 4.1 Run `vale-prepare.cjs` on PR A's branch, publish the `@taskless/vale-grammars` tarball by hand with `npm publish --access public --tag latest`, and register its npm trusted publisher against `release-vale.yml` and `npm-autopublish`; verify with `npm view @taskless/vale-grammars versions`.
- [ ] 4.2 Merge PR A, then confirm the `Release Vale` run's gate publishes nothing and that `vale-upgrade.yml` produces a head carrying all seven pins.

## 5. CLI wiring (PR B)

- [ ] 5.1 Add `@taskless/vale-grammars` to `packages/cli/package.json` `dependencies` at the exact published version, if the upgrade workflow has not already, and regenerate `pnpm-lock.yaml`; verify with `pnpm install --frozen-lockfile`.
- [ ] 5.2 Add the grammar resolver beside `findValeBinary` (spec, per-process cache, miss as `{ path: undefined, tried }`); verify with unit tests for a resolved package and a missing one.
- [ ] 5.3 Set `VALE_GRAMMARS_PATH` in `spawnVale`'s child environment when the resolver returns a path; verify that the six #703 vendor-contract failures pass with no `VALE_GRAMMARS_PATH` in the test shell.
- [ ] 5.4 Export the grammar spec and resolver from `src/node/runtimes/index.ts` with a note in the entry's documentation; verify the build's export classification passes and `dist/node/runtimes/index.d.ts` declares both.

## 6. Refusal and coverage (PR B)

- [ ] 6.1 In `assembleValeConfig`, refuse when `<rules tree>/config/grammars/` exists, with a tree-level refusal that `validate` and `check` both report; verify with tests for the `validate` failure, the `check` failure with non-zero exit and ast-grep results still reported, and an empty directory.
- [ ] 6.2 Add the D6 coverage case to `test/vale-vendor-contract.test.ts`: every comment-tier extension in `VALE_FORMAT_TIERS`, run with the pinned grammars, produces no `grammar "<name>" is not installed` warning; verify it fails when one grammar is withheld and passes with the full set.
- [ ] 6.3 Extend `engine-version-consistency.test.ts` so the grammar pin's Vale component equals `VALE_VERSION` and the platform pins'; verify it fails on a mismatched pin.

## 7. Release notes (PR B)

- [ ] 7.1 Add the Vale 3.27.0 entry to the `update` ledger in `src/agent/update.md`, stating that behavior is unchanged and that a `.taskless/rules/vale/config/grammars/` directory is now refused; verify the reconcile-marker and prompt parity tests pass.
- [ ] 7.2 Grow `.changeset/vale-3-27-0.md` (patch) to say the grammars ship as their own package and an unvetted grammar directory in the rules tree is refused; verify the `Changeset` check stays green.

## 8. PR B checks and archive

- [ ] 8.1 Run `pnpm build`, `pnpm typecheck`, `pnpm lint`, and the full CLI suite and confirm they pass on every branch of PR B.
- [ ] 8.2 Archive with `pnpm openspec archive vale-grammars-package -y` after confirming every prior scenario in the three standing specs survives (the pre-archive check in AGENTS.md); open PR B to `main` with `Refs #703` and request `@claude /review`.
