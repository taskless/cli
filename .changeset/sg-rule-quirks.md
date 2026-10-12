---
"@taskless/cli": patch
---

`taskless agent create-sg-rule` now collects its ast-grep authoring traps into one **Quirks** section, and the recipe moves to topic v7. Each entry gives the symptom (a config error that aborts the scan, or a rule that silently matches nothing), a minimal repro, and the workaround, and the table says which ones `validate` reports. Two new entries: a keyword such as `readonly` is not a valid `kind` (read kinds from `--debug-query=ast`, not the CST dump), and in TypeScript and Tsx `await f<T>(...)` parses as a call of the await expression, so a rule keyed on the callee silently skips every awaited generic call. Both workarounds cover the common shapes (`private readonly x`, optional and decorated parameters, method callees) and pass `verify`.
