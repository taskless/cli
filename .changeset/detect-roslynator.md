---
"@taskless/cli": patch
---

`taskless detect` now recognizes C# repositories and the Roslynator, StyleCop and SonarAnalyzer analyzers. C# comes from a `.csproj`. Roslynator comes from its NuGet packages in an MSBuild file, `packages.config` or `dotnet-tools.json`, its keys in `.editorconfig` or `.globalconfig`, a `.roslynatorconfig`, or a CI or hook command that runs it. StyleCop and SonarAnalyzer are each reported as their own linter, from their NuGet package, their config file, or their diagnostic ids.
