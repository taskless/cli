---
"@taskless/cli": patch
---

`taskless verify --json` now reports every fixture case under each rule's new `cases` array, for `sg`, `vale` and `runtime` alike: `{ name, expected, ok, message?, files? }`, where `name` is the case's path under `tests/` (such as `fail/cast`). A failing case carries the same line `errors` prints for it as `message`, and its files as `files` (project-relative paths, the spelling `findings[].file` uses; a file over 64 KiB or one that is not text is left out). The entries are built from each runner's own per-case verdict, so a consumer no longer has to parse `errors` to learn which case failed. The field is additive: `errors` is unchanged, and `cases` is always present, empty when no case ran (for `validate`, a refused runtime run, or a rule that failed before its fixtures ran). It is also declared in the schema `@taskless/cli/schemas` publishes.
