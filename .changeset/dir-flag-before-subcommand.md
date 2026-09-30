---
"@taskless/cli": patch
---

`-d <path>` / `--dir <path>` now works before a subcommand. `taskless auth -d .` and `taskless -d . info` used to fail with "Unknown command `.`", because the path was read as the subcommand's name. Only the `--dir=<path>` spelling worked.
