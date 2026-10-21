# Topic: auth     (CLI v%(CLI_VERSION)s / topic v5)

%(ONE_COMMAND_PER_CALL)s

## Goal
Manage Taskless authentication. Three branches:
- **Login**: start the device-code flow and wait for the user to
  approve in their browser.
- **Logout**: remove the saved token.
- **Status**: check whether a token is present and whose identity
  it represents.

## Preconditions
- `.taskless/` directory exists.
- For login: the user has a browser to approve the device code.

`auth` runs on any version of the CLI. Most commands refuse with
`CLI_VERSION_MISMATCH` when the running CLI is not the version
`.taskless/taskless.json` records, but a login is a token saved in
`.taskless/.env.local.json`, not something a version owns, so `auth`
is exempt. Use the invocation below anyway. A person logging in by hand
can run `auth login` from any version, launcher or not. When another
command refused with `CLI_VERSION_MISMATCH`, logging in does not fix
it. Follow that message's own remedy.

## Steps

Pick the branch matching the user's intent.

### Login

Log in with `--json`. Without it, `auth login` blocks until the user
approves, and you would not see the URL they need until then. With it,
each call is one short step you repeat:

1. Run:
   ```
   %(TASKLESS_CLI)s auth login --json
   ```
   It returns at once with
   `{ "ok": true, "status": "pending", "verificationUrl", "userCode", "expiresAt" }`.
2. Tell the user to open `verificationUrl` and enter `userCode`. Do
   this before the next call: the next call waits on their approval.
3. Run the same command again. Each call waits at most 45 seconds,
   then prints one of:
   - `"status": "pending"`: not approved yet. Run it again. If
     `userCode` differs from the one you showed, the earlier code
     expired and a new login started: show the new URL and code.
   - `"status": "authenticated"`: done. The token is saved to
     `.taskless/.env.local.json`.
   - An error envelope: see **Errors** below.
4. Report success. Suggest `%(TASKLESS_CLI)s info` to verify identity.

Stop calling once the user says they will not approve, and run
`%(TASKLESS_CLI)s auth logout` to discard the pending login.

If a saved token is already present, `auth login` asks the service
whether it is still accepted. A rejected token (revoked or expired)
is replaced by a fresh login; an accepted one is kept and the CLI
prints `{ "ok": true, "status": "already_logged_in", "source": "saved" }`.
Neither is an error.

If the token comes from the `TASKLESS_TOKEN` environment variable,
`auth login` prints `"source": "environment"` and does nothing else: a
saved login would not be used while the variable is set. Tell the user
to replace or unset `TASKLESS_TOKEN`.

The `--anonymous` flag is rejected on `auth login`, it errors with
"auth commands cannot be anonymous". Don't pass it.

### Logout

1. Run:
   ```
   %(TASKLESS_CLI)s auth logout
   ```
2. The CLI removes the saved token (or reports "Not logged in" if
   none was present). When `TASKLESS_TOKEN` is set it says the
   variable is still used instead: logout cannot remove it.
3. Report the outcome.

### Status (no subcommand)

1. Run:
   ```
   %(TASKLESS_CLI)s auth
   ```
2. Output is one of:
   - "Not logged in." (with hint to run `auth login`)
   - "Logged in as <user> (<orgs>)." (with "via TASKLESS_TOKEN" when
     the token comes from the environment)
   - "Logged in, but the token was rejected." (revoked or expired;
     the next line names the fix: `auth login` for a saved token,
     replacing or unsetting `TASKLESS_TOKEN` otherwise)
   - "Logged in, but unable to verify identity." (the service could
     not be reached; retry later)
3. Report to the user.

## Errors

`auth login` and `auth logout` accept `--json`. On error, the
standardized `{ ok: false, code, message }` envelope is written to
stdout (and human text on stderr is suppressed). On success,
`auth login --json` prints the `ok: true` envelopes described under
**Login**, and `auth logout --json` exits 0 silently. The status path (`%(TASKLESS_CLI)s auth` with no subcommand) accepts
`--json` for forward-compat but currently has no error paths to
report.

| code            | meaning                                                                              | fix                                  |
|-----------------|--------------------------------------------------------------------------------------|--------------------------------------|
| `INVALID_INPUT` | `--anonymous` passed to `auth login` (rejected: auth commands cannot be anonymous)   | Don't pass `--anonymous`             |
| `NETWORK_ERROR` | Device flow / token endpoint unreachable. The pending login is kept                  | Check connectivity; run it again     |
| `AUTH_EXPIRED`  | The code expired before the user approved it                                         | Run it again; show the new URL/code  |
| `AUTH_REQUIRED` | The user denied the authorization request in their browser                           | Ask the user; run it again to retry  |

## See Also

- `%(TASKLESS_CLI)s agent info`: see auth state and skill versions
- `%(TASKLESS_CLI)s agent route`: first action that requires auth
