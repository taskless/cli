---
"@taskless/cli": patch
---

`rule create --from`, `rule improve --from` and `feedback send --from` now say what is wrong with a request file. A validation error names each failing field (`prompt: expected string, received undefined; successCases.0: …`) instead of repeating bare messages, a read failure gives the resolved path and the reason (`ENOENT`, `EISDIR`), and a JSON error carries the parser's position. `rule meta` names fields the same way. The built CLI also registers zod's English messages explicitly, since zod declares itself side-effect free and bundling had dropped them, leaving every issue as a bare "Invalid input".
