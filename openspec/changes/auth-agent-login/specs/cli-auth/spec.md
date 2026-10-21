## MODIFIED Requirements

### Requirement: Auth login initiates Device Flow

`taskless auth login` initiates the device-code flow per the existing requirement. The new `--anonymous` flag (per the `cli` capability) SHALL NOT be accepted on this command — invocation with `--anonymous` SHALL exit with code 1 and an error message stating "auth commands cannot be anonymous".

When a token is already present, `auth login` SHALL decide by where it comes from:

- A token from `TASKLESS_TOKEN` SHALL be kept without contacting the service, since a saved login would not be used while the variable is set. The CLI SHALL name `TASKLESS_TOKEN` and SHALL NOT direct the user to `auth logout`, which cannot remove it.
- A saved token SHALL be checked with the service. If the service rejects it (`401`), the CLI SHALL run the device-code flow and replace the saved token. If the service accepts it, or cannot be reached, the CLI SHALL keep the token and report that the user is already logged in, since an unreachable service says nothing about the token.

Keeping a token SHALL NOT be an error: the command exits 0, and under `--json` prints `{ "ok": true, "status": "already_logged_in", "source": "saved" }`, or `"source": "environment"` for `TASKLESS_TOKEN`.

#### Scenario: Standard login still works

- **WHEN** a user runs `taskless auth login`
- **THEN** the CLI SHALL initiate the device-code flow per the existing behavior

#### Scenario: Login rejects --anonymous

- **WHEN** a user runs `taskless auth login --anonymous`
- **THEN** the CLI SHALL exit with code 1
- **AND** SHALL print "auth commands cannot be anonymous" (or similar)

#### Scenario: A rejected saved token is replaced

- **WHEN** `.taskless/.env.local.json` holds a token the service answers with `401`, and `TASKLESS_TOKEN` is not set
- **AND** a user runs `taskless auth login`
- **THEN** the CLI SHALL run the device-code flow
- **AND** on approval SHALL overwrite the saved token with the new one

#### Scenario: An accepted saved token is kept

- **WHEN** the saved token is accepted by the service
- **AND** a user runs `taskless auth login`
- **THEN** the CLI SHALL NOT start the device-code flow
- **AND** SHALL report that the user is already logged in and name `auth logout` as the way to re-authenticate

#### Scenario: An unreachable service keeps the saved token

- **WHEN** the service cannot be reached to check the saved token
- **AND** a user runs `taskless auth login`
- **THEN** the CLI SHALL keep the saved token and SHALL NOT start the device-code flow

#### Scenario: A token from TASKLESS_TOKEN is named

- **WHEN** `TASKLESS_TOKEN` is set
- **AND** a user runs `taskless auth login`
- **THEN** the CLI SHALL NOT contact the service
- **AND** SHALL name `TASKLESS_TOKEN` as the token in use
- **AND** SHALL NOT direct the user to `auth logout`

#### Scenario: Keeping a token under --json is reported

- **WHEN** the saved token is accepted by the service
- **AND** a user runs `taskless auth login --json`
- **THEN** stdout SHALL contain `{ "ok": true, "status": "already_logged_in", "source": "saved" }`
- **AND** the exit code SHALL be 0

## ADDED Requirements

### Requirement: Auth login under --json completes across repeated bounded calls

`taskless auth login --json` SHALL never block for longer than 45 seconds, so that an agent whose tool returns output only on exit can relay the verification URL and complete a login. It SHALL decide from a pending code saved in the repository whether to start a login or continue one:

- With no pending code, it SHALL request a device code, save it, and return at once with `{ "ok": true, "status": "pending", "verificationUrl": "...", "userCode": "...", "expiresAt": "<ISO 8601>" }`.
- With a pending code, it SHALL poll for at most 45 seconds. It SHALL print `{ "ok": true, "status": "authenticated" }` and save the token when the user approves, and the same `pending` envelope, with the same URL and code, when the wait ends first.
- A denial SHALL fail with `AUTH_REQUIRED`. A code that expires while the call waits SHALL fail with `AUTH_EXPIRED`. Both SHALL discard the pending code.
- A pending code that has already expired when the call starts SHALL be discarded, and the call SHALL start a new login.

The pending code SHALL be saved to `.taskless/.auth-pending.json` with mode `0600` and listed in `.taskless/.gitignore`. It SHALL be removed on approval, denial, expiry, `auth logout`, and a successful login without `--json`. The checks for an existing token SHALL run before any pending code is read or created. Without `--json`, `auth login` SHALL keep its single blocking flow.

#### Scenario: The first call returns the URL at once

- **WHEN** no token is present and no login is pending
- **AND** an agent runs `taskless auth login --json`
- **THEN** stdout SHALL contain a `pending` envelope with `verificationUrl`, `userCode`, and `expiresAt`
- **AND** the command SHALL exit 0 without polling
- **AND** `.taskless/.auth-pending.json` SHALL exist with mode `0600` and be listed in `.taskless/.gitignore`

#### Scenario: A later call completes the login

- **WHEN** a login is pending and the user approves it during the next call
- **THEN** stdout SHALL contain `{ "ok": true, "status": "authenticated" }`
- **AND** the token SHALL be saved to `.taskless/.env.local.json`
- **AND** `.taskless/.auth-pending.json` SHALL no longer exist

#### Scenario: A call that outlasts its wait repeats the pending envelope

- **WHEN** a login is pending and the user has not approved it within 45 seconds
- **THEN** the call SHALL return within 45 seconds plus one poll
- **AND** stdout SHALL contain the `pending` envelope with the same `verificationUrl` and `userCode` as the first call

#### Scenario: Expiry during a call is reported

- **WHEN** a login is pending and its code expires while a call is polling
- **THEN** stdout SHALL contain `{ "ok": false, "code": "AUTH_EXPIRED", "message": "..." }`
- **AND** the exit code SHALL be non-zero
- **AND** `.taskless/.auth-pending.json` SHALL no longer exist

#### Scenario: A denial is reported

- **WHEN** a login is pending and the user denies it
- **THEN** stdout SHALL contain `{ "ok": false, "code": "AUTH_REQUIRED", "message": "..." }`
- **AND** `.taskless/.auth-pending.json` SHALL no longer exist

#### Scenario: An abandoned login is replaced, not reported

- **WHEN** `.taskless/.auth-pending.json` holds a code whose expiry has already passed
- **AND** an agent runs `taskless auth login --json`
- **THEN** the CLI SHALL request a new device code
- **AND** stdout SHALL contain a `pending` envelope with the new code

#### Scenario: Logout discards a pending login

- **WHEN** a login is pending and a user runs `taskless auth logout`
- **THEN** `.taskless/.auth-pending.json` SHALL no longer exist

#### Scenario: The interactive login is unchanged

- **WHEN** a user runs `taskless auth login` without `--json`
- **THEN** the CLI SHALL print the URL and code and poll until approval, denial, or expiry in one call
