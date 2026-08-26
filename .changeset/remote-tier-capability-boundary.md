---
"@taskless/cli": minor
---

Report a missing GitHub remote as a boundary on remote rule generation, not as a broken repository.

Remote rule generation needs a verifiable org, which comes from a GitHub `origin`. Local rule authoring, `verify`, `test` and `check` do not, and never did. Previously all three no-remote situations failed with one code and a message telling the user to fix their repository, which reads as a setup or auth problem rather than as one tier being unavailable. A project that is not a git repository at all, such as a notes vault, had no obvious path forward.

Three codes replace the single collapsed one, because the remedies differ and an agent has to pick one:

| Code                      | Situation                             | Remedy                          |
| ------------------------- | ------------------------------------- | ------------------------------- |
| `NOT_A_GIT_REPOSITORY`    | the directory is not a git repository | `git init`, or author locally   |
| `NO_ORIGIN_REMOTE`        | a git repository with no `origin`     | add a remote, or author locally |
| `UNSUPPORTED_REMOTE_HOST` | an `origin` that is not GitHub        | author locally                  |

`NO_GITHUB_REMOTE` is **retained** and remains a valid member of the error-code contract, so consumers and recipes that branch on it keep working. Error codes are an agent contract: adding one is safe, renaming one is not.

Each message now names the local authoring path that still works, so the refusal is something a reader can route around rather than a dead end. None of the three is ever reported as an authentication failure, which is pinned by a test: an agent that saw `AUTH_REQUIRED` here would send the user through `auth login`, which cannot fix any of them.

Telling "not a git repository" from "no `origin`" needs a second question, since both fail the same `git remote get-url origin` call. That probe runs only on the failure path, so an ordinary run still spawns one process rather than two.
