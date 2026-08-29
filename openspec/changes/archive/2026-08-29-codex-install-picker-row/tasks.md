Delivery shape: **single PR**. One catalog row, one deduplicating helper, its call sites, tests, and a spec delta. Landing the row without the dedupe would install `.agents/` twice, so the units are only correct together.

## 1. Catalog

- [x] 1.1 Add the `Codex` row on `.agents/`, ordered so named harnesses come before the generic `Agent Skills` fallback
- [x] 1.2 Add `uniqueShimTargets`, collapsing the catalog to one entry per directory in catalog order
- [x] 1.3 Say in the code why two rows share a directory, so it is not deleted as a duplicate later
- [x] 1.4 Update the `ShimTarget` doc comment, which read as promising one row per directory

## 2. Call sites

- [x] 2.1 `detectSelectedDirectories` maps the deduplicated catalog
- [x] 2.2 `buildInstallPlan` iterates the deduplicated catalog
- [x] 2.3 The wizard's pre-checked set is deduplicated; its options stay one per row
- [x] 2.4 The `generic agent skills` hint follows the generic row rather than the directory

## 3. Tests

- [x] 3.1 The picker lists Codex and Agent Skills as separate rows
- [x] 3.2 `detectSelectedDirectories` returns `.agents` once when Codex is detected
- [x] 3.3 `locationChoices` pre-checks `.agents` once when Codex is detected
- [x] 3.4 A selection naming `.agents` produces exactly one plan target, labelled `Agent Skills`
- [x] 3.5 An install of that plan writes each `.agents` skill stub once

## 4. Verification

- [x] 4.1 Confirm the tests fail with the dedupe removed
- [x] 4.2 Exercise the built CLI against a scratch directory outside the repo
- [x] 4.3 `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm cli check`
- [x] 4.4 `pnpm openspec validate --all --strict`
- [x] 4.5 Changeset
