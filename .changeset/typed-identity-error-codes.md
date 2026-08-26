---
"@taskless/cli": patch
---

Stop deriving `--json` error codes from the text of an error message.

`rule create` and `rule improve` chose between `AUTH_REQUIRED` and
`NO_GITHUB_REMOTE` by running `/git remote|origin/i` over the human-readable
message that `resolveIdentity` threw. The codes exist so a machine consumer
never parses English, and the code itself was being picked by parsing English.
It happened to be right only because both repository-URL messages contain the
words "git remote"; rewording or translating either one would have silently
told every `--json` consumer to log in when the real problem was the project's
git remote.

Each failure now throws a `CLIError` carrying its own `CLIErrorCode`, and both
call sites read that field through one shared helper. No new code was added.

The emitted codes for existing scenarios are unchanged:

| Condition                                   | Code               |
| ------------------------------------------- | ------------------ |
| Not logged in                               | `AUTH_REQUIRED`    |
| Not a git repository, or no `origin` remote | `NO_GITHUB_REMOTE` |
| `origin` remote is not on `github.com`      | `NO_GITHUB_REMOTE` |

One code does change, for a scenario that is unreachable today: an unexpected
throw from the org-resolution step now reports `INTERNAL_ERROR` rather than
whichever of the two codes its wording happened to match. That step swallows
every network and HTTP error and falls back to a nil-UUID org subject, so it
cannot fail in normal operation; anything escaping it is a CLI bug rather than
a state the caller can act on.
