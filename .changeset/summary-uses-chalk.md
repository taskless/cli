---
"@taskless/cli": patch
---

The install summary shown by `taskless init` now decides whether to colour its output the same way the rest of the CLI does, rather than running its own detection that could disagree (for example, colouring output when `TERM` is unset while the rest of the CLI prints plain text). `picocolors` is no longer a dependency.
