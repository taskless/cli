---
"@taskless/cli": patch
---

The deprecated-path guard now skips `generated/` at any depth.

`typeScriptSources` excluded only a top-level `src/generated`, so a nested
generated directory would have had every deprecated path in its transcript
reported as a call site. The exclusion exists because a generated directory is
the schema's own transcript rather than a call site, and that reasoning does not
depend on how deep it sits.
