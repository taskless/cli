---
"@taskless/cli": patch
---

`taskless check` now exits 1 when the Taskless service withholds a runtime rule because the organization's plan does not include runtime rules, instead of printing a notice and exiting 0. The output names the withheld rules and links to the upgrade page, and `--json` carries an `entitlement` object. If a CI job starts failing with this, the rules did not stop matching: they stopped running, and the fix is the plan, not the code. Unauthenticated and `--anonymous` runs, and `sg` and `vale` rules, are unchanged.
