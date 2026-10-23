---
"@taskless/cli": patch
---

`taskless check` prints only error-severity findings when `CI` is `true` or `1`, and ends with a count of the warnings, infos, and hints it left out. Pass `--include-warnings` to print them. `--json` output and the exit code are unchanged.
