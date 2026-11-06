## ADDED Requirements

### Requirement: Detect recognizes C# and Roslynator

`detect` SHALL report `C#` among `languages` when a `.csproj` file exists in the scanned tree. A `.sln` file SHALL NOT mark C#, because a solution can hold projects in any language.

`detect` SHALL report `roslynator` when any of these exists:

- A NuGet reference to `Roslynator.Analyzers`, `Roslynator.Formatting.Analyzers`, `Roslynator.CodeAnalysis.Analyzers`, or `Roslynator.DotNet.Cli`, matched case-insensitively, as a `PackageReference` or `GlobalPackageReference` in a `.csproj`, `.props`, or `.targets` file, an entry in a `packages.config`, or a tool in a `dotnet-tools.json`.
- A key in `.editorconfig` or `.globalconfig` that begins `roslynator_`, `dotnet_diagnostic.rcs` followed by a digit, or `dotnet_analyzer_diagnostic.category-roslynator.`, matched case-insensitively.
- A `.roslynatorconfig` file.
- A root CI or hook command that runs `roslynator analyze`, `fix`, or `format`, or names `roslynator.dotnet.cli`.

A key in a comment, a reference in an XML comment, and a `PackageVersion` entry SHALL NOT be evidence: central package management can pin a package no project uses. Files under `bin` or `obj` SHALL NOT be read. A repository being C# SHALL NOT by itself report `roslynator`.

#### Scenario: A C# repository with no Roslynator

- **WHEN** a repository has a `.csproj` and nothing references or configures Roslynator
- **THEN** `detect --json` SHALL report `C#` among `languages` and SHALL NOT report `roslynator`

#### Scenario: Roslynator installed from a shared MSBuild file

- **WHEN** `Directory.Build.props` has a `PackageReference` to `Roslynator.Analyzers`
- **THEN** `detect --json` SHALL report `roslynator` with a dependency marker naming that file
- **AND** SHALL report `C#` among `languages`

#### Scenario: Roslynator configured in EditorConfig

- **WHEN** `.editorconfig` sets `dotnet_diagnostic.RCS1044.severity`
- **THEN** `detect --json` SHALL report `roslynator` with evidence naming the file and the key

#### Scenario: Roslynator run from CI

- **WHEN** a root GitHub Actions workflow runs `roslynator analyze`
- **THEN** `detect --json` SHALL report `roslynator` with evidence naming the workflow file and the command

#### Scenario: A central version pin is not evidence

- **WHEN** the only mention of Roslynator is a `PackageVersion` in `Directory.Packages.props`
- **THEN** `detect --json` SHALL NOT report `roslynator`

#### Scenario: A commented-out signal is not evidence

- **WHEN** the only mention of Roslynator is an XML comment in a project file or a comment in `.editorconfig`
- **THEN** `detect --json` SHALL NOT report `roslynator`

#### Scenario: Another analyzer's diagnostic id is not evidence

- **WHEN** `.editorconfig` configures only `CA` or `SA` diagnostic ids
- **THEN** `detect --json` SHALL NOT report `roslynator`

### Requirement: Detect keeps Roslyn analyzers as separate linters

`detect` SHALL report each Roslyn analyzer under its own name and SHALL NOT report a combined `roslyn` linter. Being a C# repository SHALL NOT by itself report any of them.

`detect` SHALL report `stylecop` from a `StyleCop.Analyzers` NuGet reference, a `stylecop.json` or `.stylecop.json` file, or a `dotnet_diagnostic.sa` key followed by a digit in `.editorconfig` or `.globalconfig`.

`detect` SHALL report `sonaranalyzer` from a `SonarAnalyzer.CSharp` NuGet reference, a `SonarLint.xml` file, or a `dotnet_diagnostic.s` key followed by a digit in `.editorconfig` or `.globalconfig`.

NuGet references and config keys SHALL be read as they are for `roslynator`.

#### Scenario: Analyzers sharing one EditorConfig

- **WHEN** one `.editorconfig` configures `RCS`, `SA` and `S` diagnostic ids
- **THEN** `detect --json` SHALL report `roslynator`, `stylecop` and `sonaranalyzer` as three linters

#### Scenario: StyleCop configured by its own file

- **WHEN** a repository has a `stylecop.json`
- **THEN** `detect --json` SHALL report `stylecop` with that path as evidence, and no other analyzer

#### Scenario: SonarAnalyzer installed as a package

- **WHEN** a project file has a `PackageReference` to `SonarAnalyzer.CSharp`
- **THEN** `detect --json` SHALL report `sonaranalyzer` with a dependency marker naming that file

#### Scenario: An SDK analyzer id is not evidence

- **WHEN** `.editorconfig` configures only `CA` diagnostic ids
- **THEN** `detect --json` SHALL NOT report any of these analyzers
