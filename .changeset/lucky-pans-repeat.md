---
"@taskless/cli": patch
---

Rule repair now takes a drifted rule's id from the reconcile entry that reports it, rather than parsing it out of the reported `check.ts` path. The server sends `ruleId` on every `unsafe` entry, so the parse and its fallback are gone. The parse tied repair to a filesystem layout that has moved twice, and a further move would have broken it silently: a wrong id, a 404 from restore, and a rule left unrepaired and unexecuted with nothing reported.

A reconcile entry that arrives without a usable `ruleId` is now skipped with a notice instead of becoming a request. The service's schema requires the field, but the CLI decodes the response with a cast rather than a schema, so a rollback or a regression could previously send the CLI to `/cli/api/request/undefined/restore`. This covers `missing` as well as `unsafe`; the rule stays withheld, which is already the safe state, and the notice reaches the `--json` envelope so a CI run can see it.
