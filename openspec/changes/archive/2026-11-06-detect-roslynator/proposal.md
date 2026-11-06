## Why

`taskless detect` has no notion of C#. A .NET repository reports no language and no linter, so `init`, `onboard` and the `route` recipe treat it as an unlinted project of unknown language, even though ast-grep rules work there through `CSharp`. Roslynator is a common Roslyn analyzer set, and because it is configured through `.editorconfig` and installed as a NuGet package, none of detect's existing readers can see it.

## What Changes

- `detect` reports `C#` among `languages` when a `.csproj` exists anywhere in the walk.
- A new `roslynator` linter signal, per https://josefpihrt.github.io/docs/roslynator/configuration, read from:
  - NuGet references to `Roslynator.Analyzers`, `Roslynator.Formatting.Analyzers`, `Roslynator.CodeAnalysis.Analyzers` and `Roslynator.DotNet.Cli`, in any `.csproj`, `.props` or `.targets` file, a `packages.config`, or a `dotnet-tools.json`.
  - Roslynator's keys in `.editorconfig` or `.globalconfig`: `roslynator_*`, `dotnet_diagnostic.RCS*`, and `dotnet_analyzer_diagnostic.category-roslynator.*`.
  - A committed `.roslynatorconfig`.
  - Root CI and hook commands that run or install it.
- `stylecop` and `sonaranalyzer` signals, separate from `roslynator` and from each other, per the StyleCop Analyzers configuration doc and the sonar-dotnet README. Each is read from its NuGet package, its own config file (`stylecop.json`, `.stylecop.json`, `SonarLint.xml`), and its `SA` or `S` diagnostic ids. Neither has CLI invocation evidence: both run inside the build.
- `configKeys` joins `LinterSignal`: keys in a shared config file, which any later analyzer configured through `.editorconfig` can reuse.
- `bin` and `obj` join the directories the walk prunes, as .NET build output.

Nothing here is **BREAKING**. Pre-1.0, an added linter signal is a `patch`.

## Non-goals

- **A combined `roslyn` linter.** People know the tool they installed, not the platform under it, so each analyzer keeps its own name.
- **The SDK's own `CA` rules.** They ship with the toolchain, so they need signals of their own, as clippy did.
- **`customRules` for Roslynator.** It has no custom-rule mechanism of its own; a house analyzer is a Roslyn concern, independent of Roslynator.
- **A `create-legacy-rule` recipe.** Without one the legacy ladder does not apply, so a rule request in a Roslynator repository routes to a Taskless rule, as it does for rubocop and clippy.
- **The telemetry `languageStack` dimension.** It probes exact root paths and a project file has no fixed name, so it does not report C#.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-detect`: new requirements cover C# and Roslynator detection, and separate StyleCop and SonarAnalyzer linters.

## Impact

- `packages/cli/src/detect/scan.ts`: NuGet readers, `configKeys`, the signals, and two pruned directories.
- `packages/cli/src/schemas/detect.ts`, `packages/cli/src/agent/detect.md`: the evidence description gains config keys.
- `packages/cli/test/detect.test.ts`: positive and negative cases per signal.

## Delivery shape

**Single PR.** One signal and its readers, tests, spec delta and archive fit one reviewable diff and are safe in production on their own.
