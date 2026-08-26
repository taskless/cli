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

`taskless info --json` now also reports `repositoryUrl` and `ghOwner`, so a caller deciding whether remote generation is available reads the same resolution the CLI enforces instead of shelling out to git and reaching a different answer. `repositoryUrl` is the canonical GitHub URL or `null`; `ghOwner` is the owner segment or the literal `[unknown]`. Both resolve without failing, including on a host with no git installed, and both are present under `--anonymous` because capability state is not auth state. `taskless auth` is unchanged and stays plain text.

Telemetry now records `gh_owner`, so it is possible to see which GitHub owners use the CLI, including on anonymous runs. It resolves from the git remote rather than from the token, and is the owner segment when one is found or the literal `[unknown]` when not, so runs with no resolvable owner stay countable rather than disappearing from aggregates. `gh_owner` rather than `gh_org` because the first path segment of a GitHub URL is an organization or a user account, and telling them apart needs an authenticated API call an anonymous run cannot make; owner type is never inferred.
