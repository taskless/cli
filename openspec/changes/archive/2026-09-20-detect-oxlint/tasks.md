## 1. Implementation

- [x] 1.1 Verify against https://oxc.rs/docs/guide/usage/linter/config.html which config filenames oxlint discovers on its own; exclude any `oxlint.config.*` variant that is only reachable through `-c`.
- [x] 1.2 Add the `oxlint` entry to `LINTER_SIGNALS` in `packages/cli/src/detect/scan.ts`, shaped like `biome`, with a comment naming the excluded filenames and why.
- [x] 1.3 Add tests in `packages/cli/test/detect.test.ts`: `.oxlintrc.json` alone detects oxlint; `oxlint` in `devDependencies` alone detects oxlint; an eslint-only repo does not report oxlint.
- [x] 1.4 Add `.changeset/detect-oxlint.md` (`patch`).

## 2. Spec

- [x] 2.1 Write the `cli-detect` delta restating the full "Detect scans deterministic repo signals only" requirement with every existing scenario, the updated example list, and the new oxlint scenario.
- [x] 2.2 `pnpm openspec validate --strict`, then the dry-run archive check from CLAUDE.md (scenario count before vs after), then archive for real.

## 3. Verification

- [x] 3.1 `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @taskless/cli test` all pass.
