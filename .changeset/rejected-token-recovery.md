---
"@taskless/cli": patch
---

A token the Taskless service rejects no longer leaves you at a dead end. `taskless auth login` now checks a saved token with the service and replaces it when it has been revoked or has expired, instead of refusing because a token is present, so the `auth login` that every authentication error recommends actually works. Every "authentication was rejected" message now names the command to run, including the `rule create` and `rule improve` messages that only said "Log in again." When the token comes from the `TASKLESS_TOKEN` environment variable, those messages, `taskless auth`, `auth login` and `auth logout` say so, since only changing the variable fixes it.
