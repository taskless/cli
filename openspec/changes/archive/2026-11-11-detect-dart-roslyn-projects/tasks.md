## 1. Implementation

- [x] 1.1 Add the `Dart` language marker, the `pubspec.yaml` reader, the `dart-analyzer` signal and `.dart_tool` pruning to `packages/cli/src/detect/scan.ts`.
- [x] 1.2 Read analyzer `ProjectReference`s in the MSBuild pass, resolve them to scanned projects, and add the `custom-analyzer` signal.
- [x] 1.3 Count `[DiagnosticAnalyzer]` classes for `custom-analyzer` in `packages/cli/src/detect/custom-rules.ts`.
- [x] 1.4 Add positive and negative fixtures to `packages/cli/test/detect.test.ts`.
- [x] 1.5 Describe the new evidence in `packages/cli/src/schemas/detect.ts` and the `detect` recipe.
- [x] 1.6 Add `.changeset/detect-dart-roslyn-projects.md` (`patch`).

## 2. Verification

- [x] 2.1 `pnpm typecheck`, `pnpm lint`, and `pnpm --filter @taskless/cli test` pass.
- [x] 2.2 `pnpm openspec validate --strict`, then archive.
