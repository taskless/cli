## Why

`taskless detect --json` misses two setups that agents in the CLI PMF survey had to find by hand (#680). A Flutter repository reported only Ruby and Java, from the `Gemfile` and `build.gradle` in its `ios/` and `android/` platform folders, and never Dart or the Dart analyzer, although Dart is an ast-grep language route can send rules to. A C# solution whose real lint rules live in its own Roslyn analyzer project, wired in with `<ProjectReference ... OutputItemType="Analyzer" />`, reported no C# linter, so route could not apply the legacy ladder and agents risked duplicating rules the repository already enforces.

## What Changes

- `detect` reports `Dart` among `languages` when a `pubspec.yaml` exists anywhere in the walk.
- A new `dart-analyzer` linter signal, read from an `analysis_options.yaml`, a `lints`, `flutter_lints` or `very_good_analysis` package in a `pubspec.yaml`'s `dependencies` or `dev_dependencies`, or a root CI or hook command that runs `dart analyze` or `flutter analyze`.
- A new `custom-analyzer` linter signal for C#: a `ProjectReference` in a `.csproj`, `.props` or `.targets` file whose `OutputItemType` is `Analyzer`, as an attribute or child metadata. The evidence names the referenced project and the file that references it.
- `custom-analyzer` reports `customRules`: the `[DiagnosticAnalyzer]` attributes in the `.cs` files under the referenced project's directory, outside `bin` and `obj`. A reference whose project cannot be found makes the count `"unknown"`.
- `.dart_tool` joins the directories the walk prunes.
- The `detect` recipe (topic v6) and the JSON schema's descriptions mention the new evidence.

Nothing here is **BREAKING**. Pre-1.0, an added linter signal is a `patch`.

## Non-goals

- **Suppressing Ruby and Java in a Flutter app.** The `ios/` and `android/` platform folders really do hold a `Gemfile` and Gradle build; detect reports what is on disk.
- **Evaluating MSBuild.** An `Include` built from a property other than `$(MSBuildThisFileDirectory)` is matched to a scanned project by file name, and only when exactly one project has that name.
- **Custom lint packages for Dart** (`custom_lint`, analyzer plugins). They are a separate mechanism, so `dart-analyzer` reports no `customRules`.
- **A `create-legacy-rule` recipe** for either linter. Both appear in route's list of detected linters with no guide of their own.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-detect`: new requirements cover Dart and the Dart analyzer, and a C# repository's own analyzer project.

## Impact

- `packages/cli/src/detect/scan.ts`: the Dart marker, `pubspec.yaml` reader, both signals, the analyzer-reference reader and its path resolution.
- `packages/cli/src/detect/custom-rules.ts`: the analyzer count.
- `packages/cli/src/schemas/detect.ts`, `packages/cli/src/agent/detect.md`: descriptions of the new evidence.
- `packages/cli/test/detect.test.ts`: positive and negative fixtures for both.
- Telemetry's root-only `languageStack` reads `LANGUAGE_MARKERS`, so it reports `Dart` for a root `pubspec.yaml`.

## Delivery shape

**Single PR.** Two signals with their readers, tests, spec delta and archive fit one reviewable diff and are safe in production on their own.
