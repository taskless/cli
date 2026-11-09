---
"@taskless/cli": patch
---

When the Taskless service no longer supports the running CLI version, every command that talks to it now says so and tells you how to upgrade, instead of reporting a network failure you might retry. Under `--json` the failure is the new code `CLI_UPGRADE_REQUIRED` rather than `NETWORK_ERROR`, and `check` names the upgrade as the reason it could not verify rules.

`taskless info` now reports whether your token actually works. The JSON carries a new `authState` field (`authenticated`, `rejected`, `unreachable`, `upgrade_required`, `none`, or `anonymous` when `--anonymous` skips the check), and `loggedIn` is `true` only when the service accepted the token. Previously a rejected or expired token, or an unreachable service, still read `loggedIn: true`, and the human output said "not logged in" for all of them. It now says which one happened and what to do.

A stale or missing Taskless skill is now reported in a project with no detected agent harness directory (no `.claude/`, `.codex/`, `.gemini/`, and so on), where the skill is installed to `.agents/`. Before, `agent ok`, `check` and `info` said nothing about the skill there, however old it was.
