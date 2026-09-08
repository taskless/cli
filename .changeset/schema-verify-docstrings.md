---
"@taskless/cli": patch
---

Corrected the published `@taskless/cli/schemas` docstrings for
`verifyOutputSchema` and `valeVerifyOutputSchema`, which named a command form
— `taskless rule verify <id> --json` — that was removed when rule addressing
moved from id to path. No runtime behavior changes; the schemas themselves
are unchanged. A consumer reading these docstrings (e.g. via editor
tooltips or generated docs) would previously be pointed at a command that
does not exist.
