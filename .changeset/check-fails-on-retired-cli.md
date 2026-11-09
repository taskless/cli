---
"@taskless/cli": patch
---

`taskless check` now fails when the Taskless service no longer supports the CLI version, the same way it fails on a rejected token. Before, the run degraded to an unverified scan and exited 0 with only a notice, so CI stayed green while no rule was verified. An unreachable service still does not fail the run.
