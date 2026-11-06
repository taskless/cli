## 1. Implementation

- [x] 1.1 Read https://josefpihrt.github.io/docs/roslynator/configuration for the config files and keys, and the Roslynator and NuGet package pages for package ids and the CLI command.
- [x] 1.2 Add the NuGet readers, the `C#` language mark, `configKeys`, the `roslynator`, `stylecop` and `sonaranalyzer` signals and the `bin`/`obj` pruning to `packages/cli/src/detect/scan.ts`.
- [x] 1.3 Add positive and negative cases to `packages/cli/test/detect.test.ts`.
- [x] 1.4 Describe config-key evidence in `packages/cli/src/schemas/detect.ts` and the `detect` recipe.
- [x] 1.5 Add `.changeset/detect-roslynator.md` (`patch`).

## 2. Verification

- [x] 2.1 `pnpm typecheck`, `pnpm lint`, and `pnpm --filter @taskless/cli test` pass.
- [x] 2.2 `pnpm openspec validate --strict`, then archive.
