---
"@taskless/cli": patch
---

`taskless detect` now recognizes Dart and Flutter repositories and a C# repository's own Roslyn analyzers. Dart comes from a `pubspec.yaml`, and the new `dart-analyzer` linter from an `analysis_options.yaml`, a `lints`, `flutter_lints` or `very_good_analysis` package, or a CI or hook command that runs `dart analyze` or `flutter analyze`. The new `custom-analyzer` linter comes from a `ProjectReference` with `OutputItemType="Analyzer"` in a project file, `.props` or `.targets`; its evidence names the referenced project, and its `customRules` counts the `[DiagnosticAnalyzer]` classes in it.
