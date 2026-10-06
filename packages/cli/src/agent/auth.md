# Topic: auth     (CLI v%(CLI_VERSION)s / topic v2)

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

## Steps

Pick the branch matching the user's intent.

### Login

1. Run:
   ```
   %(TASKLESS_CLI)s auth login
   ```
2. The CLI prints a URL and a device code. Tell the user to open the
   URL and enter the code.
3. The CLI polls until the token is approved. On success, the token
   is written to `.taskless/.env.local.json` and a confirmation is
   printed.
4. Report success. Suggest `%(TASKLESS_CLI)s info` to verify identity.

If a saved token is already present, `auth login` asks the service
whether it is still accepted. A rejected token (revoked or expired)
is replaced by a fresh login; an accepted one is kept and the CLI
prints "You are already logged in." Neither is an error.

If the token comes from the `TASKLESS_TOKEN` environment variable,
`auth login` does nothing: a saved login would not be used while the
variable is set. Tell the user to replace or unset `TASKLESS_TOKEN`.

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
stdout (and human text on stderr is suppressed). On success in
`--json` mode, the commands exit 0 silently, no success envelope is
emitted. The status path (`%(TASKLESS_CLI)s auth` with no subcommand) accepts
`--json` for forward-compat but currently has no error paths to
report.

| code            | meaning                                                                              | fix                                  |
|-----------------|--------------------------------------------------------------------------------------|--------------------------------------|
| `INVALID_INPUT` | `--anonymous` passed to `auth login` (rejected: auth commands cannot be anonymous)   | Don't pass `--anonymous`             |
| `NETWORK_ERROR` | Device flow / token endpoint unreachable, or the device code expired before approval | Check connectivity; retry            |
| `AUTH_REQUIRED` | The user denied the authorization request in their browser                           | Re-run `%(TASKLESS_CLI)s auth login` |

## See Also

- `%(TASKLESS_CLI)s agent info`: see auth state and skill versions
- `%(TASKLESS_CLI)s agent route`: first action that requires auth
