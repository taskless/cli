---
"@taskless/cli": patch
---

`.taskless/.gitignore` now ignores `/.tmp-*`, the scratch request files the agent recipes write (`.tmp-rule-request.json`, `.tmp-improve-request.json`), so a file an agent forgot to clean up is a stray rather than a commit. This is scaffold migration 7; the scaffold's own `version` field carries the compatibility signal, and a project at 6 gains one ignore line the next time it is bootstrapped.
