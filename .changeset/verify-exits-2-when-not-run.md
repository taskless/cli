---
"@taskless/cli": patch
---

`verify` no longer reports success when a rule did not run. It used to exit 0 and print `ok: true` when a runtime rule's fixtures were skipped for want of `--dangerously-run-scripts`, so CI and agents read a rule nothing exercised as a pass. It now exits 2 and reports `ok: false` when nothing failed but a rule did not run, and still exits 1 when a rule failed.

If a script or hook runs a bare `verify` in a project with runtime rules, it now needs to change: pass `--dangerously-run-scripts` if it should run them, or name `.taskless/rules/sg` and `.taskless/rules/vale`. Pre-commit hooks should do the latter, since `--dangerously-run-scripts` never belongs in a hook.
