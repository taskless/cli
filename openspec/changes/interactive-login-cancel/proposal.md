## Why

#659 made a waiting `auth login --json` step notice an `auth logout` from another shell and save no token. The interactive `auth login` kept its device code only in memory, so a logout could not reach it: if the user then approved in the browser, the interactive process saved the token and the repository was logged in again after an explicit logout. Logout is local only and a token cannot be revoked on the service, so that token stays live with nothing able to invalidate it (#665).

The interactive flow also cleared `.taskless/.auth-pending.json` unconditionally on success, deleting a `--json` login a different process had started meanwhile.

## What Changes

- The interactive login records itself in `.taskless/.auth-pending.json` with `mode: "interactive"` when it starts, replacing any pending login, and checks after every poll that the record still names its device code, using the same check as the `--json` step. A logout or a replacing login while it waits fails it as cancelled (`AUTH_REQUIRED`), with no token saved and no `cli_authenticated` event.
- However it ends, the interactive login removes the record only while it is still its own.
- A `--json` step that finds an interactive record replaces it with a new login rather than polling the interactive process's code.
- `auth logout` removes the pending login before the token, so a login that saves a token between the two has it removed.
- The `auth` recipe names another login as a cause of `AUTH_REQUIRED`, and says a `--json` login cancels a waiting interactive one.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-auth`: the `--json` requirement gains cancelled-login scenarios and its pending file lifecycle covers the interactive mode; a new requirement covers cancelling an interactive login.

## Impact

- `packages/cli/src/auth/pending-login.ts`, `login-interactive.ts`, `login-step.ts`, `commands/auth.ts`, and the `auth` recipe.
- Delivery shape: **single PR**. One shared check, its use in the interactive flow, and tests, well under the review size.
