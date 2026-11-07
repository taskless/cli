---
"@taskless/cli": patch
---

`verify --json` now reports a `status` on each rule: `passed`, `failed`, `not-run` (the rule failed before its tests ran) or `refused` (the execution policy declined to run them). Branch on it instead of combining `ok`, `ran` and `refused`, where reading `ok` alone could report a rule that never ran as passing. The change is additive: `ok`, `ran` and `refused` are still reported and are now derived from `status`, so they always agree with it. `validate` runs no tests and does not report `status`.
