---
"@taskless/cli": patch
---

`check` no longer loses every finding in a run because one file's front
matter could not be parsed. A Vale front-matter error used to abort the
entire Vale invocation before any result was written, so `results` came back
`[]` for the whole run regardless of how many other files had findings — and
`[]` was indistinguishable from a genuinely clean pass.

`runVale` now retries around a file Vale's own error attributes to one of the
run's targets, excluding it and reporting it as a per-file finding
(`ruleId: "vale-parse-error"`, `severity: "error"`) instead of failing the
whole run. Every other file's findings are reported normally. A failure Vale
does not attribute to a single target file — a malformed rule, a timeout, a
crash — is unaffected and still fails the run exactly as before.
