## ADDED Requirements

### Requirement: Detect recognizes Dart and the Dart analyzer

`detect` SHALL report `Dart` among `languages` when a `pubspec.yaml` file exists in the scanned tree.

`detect` SHALL report `dart-analyzer` when any of these exists:

- An `analysis_options.yaml` file.
- A `lints`, `flutter_lints`, or `very_good_analysis` package under `dependencies` or `dev_dependencies` in a `pubspec.yaml`.
- A root CI or hook command that runs `dart analyze` or `flutter analyze`.

A package named only in a YAML comment SHALL NOT be evidence, and a malformed `pubspec.yaml` SHALL contribute no dependencies without failing the scan. A repository being Dart SHALL NOT by itself report `dart-analyzer`, because the analyzer ships with the SDK. Files under `.dart_tool` SHALL NOT be read.

#### Scenario: A Dart repository with no analyzer configuration

- **WHEN** a repository has a `pubspec.yaml` and nothing configures, installs a lint set for, or runs the analyzer
- **THEN** `detect --json` SHALL report `Dart` among `languages` and SHALL NOT report `dart-analyzer`

#### Scenario: A Flutter app

- **WHEN** a repository has a `pubspec.yaml` with `flutter_lints` in `dev_dependencies`, an `analysis_options.yaml`, and `ios/Gemfile` and `android/build.gradle` platform folders
- **THEN** `detect --json` SHALL report `Dart` among `languages`
- **AND** SHALL report `dart-analyzer` with `analysis_options.yaml` and a dependency marker naming `pubspec.yaml` as evidence

#### Scenario: The analyzer run from CI

- **WHEN** a root GitHub Actions workflow runs `flutter analyze`
- **THEN** `detect --json` SHALL report `dart-analyzer` with evidence naming the workflow file and the command

#### Scenario: A commented-out lint set is not evidence

- **WHEN** the only mention of a lint set is a comment in `pubspec.yaml`
- **THEN** `detect --json` SHALL NOT report `dart-analyzer`

### Requirement: Detect recognizes a C# repository's own analyzer project

`detect` SHALL report `custom-analyzer` when a `.csproj`, `.props`, or `.targets` file has a `ProjectReference` whose `OutputItemType` is `Analyzer`, matched case-insensitively, whether as an attribute or as child metadata. Each such reference SHALL add evidence naming the referenced project and the file that references it, as `analyzer project <project> (<file>)`.

`<project>` SHALL be the scanned `.csproj` the reference names when it can be told without evaluating MSBuild: a path in a `.csproj` relative to that file, a `$(MSBuildThisFileDirectory)` path relative to the file that holds it, or otherwise the one scanned project with the same file name. When none of these finds exactly one project, `<project>` SHALL be the `Include` as written.

`custom-analyzer` SHALL report `customRules`, counting each `DiagnosticAnalyzer` attribute in the `.cs` files under each found project's directory once, outside `bin`, `obj`, and comments. A reference whose project is not found SHALL make the count `"unknown"`, unless the found projects already reach the custom-rule threshold.

A `ProjectReference` without `OutputItemType="Analyzer"`, and one inside an XML comment, SHALL NOT be evidence.

#### Scenario: An analyzer project wired in from Directory.Build.props

- **WHEN** `Directory.Build.props` has `<ProjectReference Include="$(MSBuildThisFileDirectory)analyzers\House.Analyzers\House.Analyzers.csproj" OutputItemType="Analyzer" ReferenceOutputAssembly="false" />` and that project holds two `[DiagnosticAnalyzer]` classes
- **THEN** `detect --json` SHALL report `custom-analyzer` with the evidence `analyzer project analyzers/House.Analyzers/House.Analyzers.csproj (Directory.Build.props)`
- **AND** SHALL report a custom-rule count of two with `analyzers/House.Analyzers` as its evidence
- **AND** SHALL report `C#` among `languages`

#### Scenario: A project referenced by several projects is counted once

- **WHEN** two project files each reference the same analyzer project
- **THEN** `detect --json` SHALL report one evidence entry per referencing file and count that project's analyzers once

#### Scenario: An analyzer project that cannot be found

- **WHEN** the only analyzer reference is built from a property and no scanned project has its file name
- **THEN** `detect --json` SHALL report `custom-analyzer` with the `Include` as written in its evidence and a custom-rule count of `"unknown"`

#### Scenario: An ordinary project reference is not evidence

- **WHEN** a project file references another project without `OutputItemType="Analyzer"`, or only inside an XML comment
- **THEN** `detect --json` SHALL NOT report `custom-analyzer`
