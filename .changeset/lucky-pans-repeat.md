---
"@taskless/cli": patch
---

Rule repair now takes a drifted rule's id from the reconcile entry that reports it, rather than parsing it out of the reported `check.ts` path. The server sends `ruleId` on every `unsafe` entry, so the parse and its fallback are gone. The parse tied repair to a filesystem layout that has moved twice, and a further move would have broken it silently: a wrong id, a 404 from restore, and a rule left unrepaired and unexecuted with nothing reported.
