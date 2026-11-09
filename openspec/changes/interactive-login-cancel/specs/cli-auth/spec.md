## MODIFIED Requirements

### Requirement: Auth login under --json completes across repeated bounded calls

`taskless auth login --json` SHALL never block for longer than 45 seconds, so that an agent whose tool returns output only on exit can relay the verification URL and complete a login. It SHALL decide from a pending code saved in the repository whether to start a login or continue one:

- With no pending code, it SHALL request a device code, save it, and return at once with `{ "ok": true, "status": "pending", "verificationUrl": "...", "userCode": "...", "expiresAt": "<ISO 8601>" }`.
- With a pending code, it SHALL poll for at most 45 seconds. It SHALL print `{ "ok": true, "status": "authenticated" }` and save the token when the user approves, and the same `pending` envelope, with the same URL and code, when the wait ends first.
- A denial SHALL fail with `AUTH_REQUIRED`. A code that expires while the call waits SHALL fail with `AUTH_EXPIRED`. Both SHALL discard the pending code.
- A pending code that has already expired when the call starts SHALL be discarded, and the call SHALL start a new login.
- A pending code recorded by an interactive `auth login` (one without `--json`) SHALL NOT be polled. The call SHALL replace it and start a new login, which cancels the interactive one.
- After every poll and before every write, the call SHALL re-read the saved pending code. When it is gone (`auth logout` ran) or names a different device code (another login replaced it), the call SHALL fail with `AUTH_REQUIRED`, SHALL NOT save a token, and SHALL NOT remove or rewrite the pending code it finds.

The pending code SHALL be saved to `.taskless/.auth-pending.json` with mode `0600` and listed in `.taskless/.gitignore`, together with which flow started it. It SHALL be removed on approval, denial, expiry, and `auth logout`, and by an interactive login that finishes while it is still its own. The checks for an existing token SHALL run before any pending code is read or created. Without `--json`, `auth login` SHALL keep its single blocking flow.

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

#### Scenario: A call cancelled by logout saves no token

- **WHEN** a call is polling a pending login
- **AND** `taskless auth logout` runs in another shell
- **AND** the user then approves the login
- **THEN** stdout SHALL contain `{ "ok": false, "code": "AUTH_REQUIRED", "message": "..." }` with a message saying the login was cancelled
- **AND** the exit code SHALL be non-zero
- **AND** no token SHALL be saved

#### Scenario: A call whose login was replaced leaves the replacement alone

- **WHEN** a call is polling a pending login
- **AND** another login replaces `.taskless/.auth-pending.json` with a different device code
- **THEN** the call SHALL fail with `AUTH_REQUIRED` and save no token
- **AND** `.taskless/.auth-pending.json` SHALL still hold the replacing login

#### Scenario: An interactive login's code is replaced, not polled

- **WHEN** `.taskless/.auth-pending.json` holds an unexpired code recorded by an interactive `auth login`
- **AND** an agent runs `taskless auth login --json`
- **THEN** the CLI SHALL request a new device code without polling the interactive one
- **AND** stdout SHALL contain a `pending` envelope with the new code

## ADDED Requirements

### Requirement: An interactive auth login is cancelled by a logout while it waits

`taskless auth login` without `--json` SHALL record its device code in `.taskless/.auth-pending.json`, marked as interactive, when it starts, replacing any pending login. After every poll it SHALL re-read that file. When the file is gone (`auth logout` ran) or names a different device code (another login replaced it), the login SHALL end as cancelled: it SHALL NOT save a token, even one the user approves afterwards, SHALL fail with `AUTH_REQUIRED` and a message saying the login was cancelled, and SHALL NOT capture `cli_authenticated` or switch telemetry to an authenticated identity.

However the interactive login ends, it SHALL remove `.taskless/.auth-pending.json` only while the file still names its own device code. A login another process recorded meanwhile SHALL be left in place.

`auth logout` SHALL remove the pending login before it removes the saved token.

#### Scenario: Logout during the wait, then approval, saves no token

- **WHEN** a user runs `taskless auth login` and it is waiting for approval
- **AND** `taskless auth logout` runs in another shell
- **AND** the user then approves the login in the browser
- **THEN** the CLI SHALL NOT save a token
- **AND** SHALL print an error saying the login was cancelled and exit non-zero, as `AUTH_REQUIRED`
- **AND** SHALL NOT capture `cli_authenticated`

#### Scenario: A login another process started is left alone

- **WHEN** a user runs `taskless auth login` and it is waiting for approval
- **AND** another process starts a login that replaces `.taskless/.auth-pending.json`
- **THEN** the interactive login SHALL end as cancelled without saving a token
- **AND** `.taskless/.auth-pending.json` SHALL still hold the other process's login

#### Scenario: A finished interactive login removes its own pending record

- **WHEN** a user runs `taskless auth login` and approves it, with no other login started meanwhile
- **THEN** the token SHALL be saved
- **AND** `.taskless/.auth-pending.json` SHALL no longer exist
