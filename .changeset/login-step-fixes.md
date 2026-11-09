---
"@taskless/cli": patch
---

`auth login --json` no longer logs a repository back in after `auth logout`. A step that was waiting on approval when you logged out now stops with `AUTH_REQUIRED` instead of saving the token or writing the pending login back to disk.
