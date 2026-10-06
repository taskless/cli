## Why

Every message that asks a user to re-authenticate after a `401` points at
`auth login`, and `auth login` refused whenever any token was present (#450).
A token the service has revoked or expired is still present locally, since
`getToken` only knows about a locally recorded `expires_at`, so the advice
could not be followed as written. Three messages (`rule create` and
`rule improve`) named no command at all.

With `TASKLESS_TOKEN` set it was worse: `auth logout` removes only the saved
file and printed `Not logged in.`, `auth login` kept refusing, and no message
mentioned the variable, so nothing the CLI printed got the user out.

The standing `cli-auth` spec also still describes the global
`~/.config/taskless/auth.json` store, which the CLI stopped writing and reading
when tokens moved per repository. It now only warns that a legacy file exists.
This change corrects those requirements while it is touching the capability.

## What Changes

- `auth login` asks the service about a saved token before refusing. A `401`
  runs the device flow and replaces the token. An accepted token, or a service
  that could not answer, keeps the token and the existing "already logged in"
  answer.
- With `TASKLESS_TOKEN` set, `auth login` does not ask the service and names
  the variable instead of sending the user to `auth logout`.
- Every "authentication was rejected" message shares one remedy: `auth login`
  for a saved token, replacing or unsetting `TASKLESS_TOKEN` when the token
  comes from the environment. This covers `check`, `rule create`, `improve`,
  `restore`, `rollback`, `revisions`, and the poll and fetch inside generation.
- `auth logout` says when `TASKLESS_TOKEN` is set and still used.
- `taskless auth` says "via TASKLESS_TOKEN" when that is the source, and
  separates a rejected token, with its remedy, from an unreachable service.
- The organization-not-found hint says `auth logout` then `auth login`, since
  its token is valid and `auth login` alone keeps it.
- `auth` agent recipe topic v2.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-auth`:
  - MODIFIED, restated in full under their existing titles: "Auth login
    initiates Device Flow" (two scenarios kept, four added), "Auth logout
    removes saved token" (two kept, one added), "Token file format", and
    "Token resolution is a shared utility". The last two are corrections to
    current behavior: every scenario is kept, with the file path and return
    value the CLI actually has.
  - REMOVED and re-ADDED under new titles, because a MODIFIED block can neither
    rename a requirement nor drop a scenario:
    - "Token resolution prefers per-repo over global" becomes "Token
      resolution prefers the environment over the saved token". Its
      "Global file used as fallback" scenario becomes "A legacy global token
      is not used".
    - "Per-repository token storage in .env.local.json" becomes "Login stores
      the token only in the repository". Its "Login also writes to global
      auth.json" scenario becomes "Login does not write a global token".
  - REMOVED: "Token is stored in XDG config directory". The CLI writes no
    global token.
  - ADDED: "A rejected token's message names a fix that works".

## Impact

Messages and one behavior change in `auth login`, which now replaces a token
the service rejects. `auth login --json` output is unchanged: it still prints
nothing and exits 0 when it keeps a token. `patch`: the package is pre-1.0 and
no consumer contract changes shape.

## Delivery shape

**Single PR.** The behavior, messages, recipe, spec and tests are one
reviewable diff. It is the tip, so the change is archived here.
