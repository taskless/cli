---
"@taskless/cli": patch
---

`auth login --json` no longer logs a repository back in after `auth logout`. A step that was waiting on approval when you logged out now stops with `AUTH_REQUIRED` instead of saving the token or writing the pending login back to disk.

`auth login --json` also keeps polling when the service asks for an interval longer than one step's 45-second wait. Each step now polls at least once, where before every step returned `pending` without polling until the code expired.
