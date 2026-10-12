---
"@taskless/cli": patch
---

`check` no longer reports a clean result for paths it never scanned. A path outside the project, existing or not, is refused with `INVALID_INPUT` and exit 1. A path that does not exist is still skipped with exit 0, so raw `git diff --name-only` output can still be piped in, but the skipped paths are now named in a notice (`notices` under `--json`).
