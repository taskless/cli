# CLI Auth

## Purpose

Defines the `auth login` and `auth logout` subcommands, the Device Flow orchestration, and the token persistence layer for the `@taskless/cli` package.

## Requirements

### Requirement: Auth subcommand group exists

The CLI SHALL register an `auth` subcommand group with `login` and `logout` as nested subcommands. Running `taskless auth` with no subcommand SHALL display help text listing the available auth subcommands.

#### Scenario: Auth help is displayed

- **WHEN** a user runs `taskless auth`
- **THEN** the CLI SHALL print help text listing `login` and `logout` subcommands

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

### Requirement: Auth logout removes saved token

`taskless auth logout` removes the saved token per the existing requirement. The `--anonymous` flag SHALL be accepted as a no-op on this command (logout is already a local operation requiring no API state).

Logout SHALL NOT read or change `TASKLESS_TOKEN`. When the variable is set, logout SHALL say that it is still used and that unsetting it is how to log out, and SHALL NOT report "Not logged in."

#### Scenario: Standard logout still works

- **WHEN** a user runs `taskless auth logout`
- **THEN** the CLI SHALL remove the saved token per the existing behavior

#### Scenario: Logout accepts --anonymous as no-op

- **WHEN** a user runs `taskless auth logout --anonymous`
- **THEN** the CLI SHALL behave identically to `taskless auth logout`

#### Scenario: Logout names TASKLESS_TOKEN

- **WHEN** `TASKLESS_TOKEN` is set and a user runs `taskless auth logout`
- **THEN** the CLI SHALL say that `TASKLESS_TOKEN` is still used
- **AND** SHALL NOT print "Not logged in."

### Requirement: Token file format

The saved token file (`.taskless/.env.local.json`) SHALL be a JSON object containing at minimum an `access_token` field. It MAY contain additional fields returned by the OAuth token response (`token_type`, `expires_in`, `refresh_token`). When the response carries a positive `expires_in`, the file SHALL also carry `expires_at`, the absolute expiry in milliseconds since the epoch, and a token past its `expires_at` SHALL be treated as absent.

#### Scenario: Minimal token file

- **WHEN** the OAuth response contains only an access token
- **THEN** `.taskless/.env.local.json` SHALL contain `{ "access_token": "<token>" }`

#### Scenario: Full token file

- **WHEN** the OAuth response contains access token, token type, and refresh token
- **THEN** `.taskless/.env.local.json` SHALL contain all provided fields

### Requirement: Token resolution is a shared utility

A `getToken()` function SHALL exist that encapsulates the token resolution logic (env var check, then file read). All commands that need the current token SHALL use this function rather than reading the file directly.

#### Scenario: getToken returns env var value

- **WHEN** `TASKLESS_TOKEN` is set to `"test-token"`
- **THEN** `getToken()` SHALL return `"test-token"`

#### Scenario: getToken returns file token

- **WHEN** `TASKLESS_TOKEN` is not set and `.taskless/.env.local.json` contains `{ "access_token": "file-token" }`
- **THEN** `getToken()` SHALL return `"file-token"`

#### Scenario: getToken returns null

- **WHEN** `TASKLESS_TOKEN` is not set and no token file exists
- **THEN** `getToken()` SHALL return `undefined`

### Requirement: Network layer is behind an interface

The Device Flow HTTP calls (device authorization and token polling) SHALL be defined as a TypeScript interface. The implementation SHALL use `fetch` to call the real API endpoints at `POST /cli/auth/device` (device authorization) and `POST /cli/auth/token` (token polling). The API base URL SHALL default to `https://app.taskless.io/cli` and SHALL be overridable via the `TASKLESS_API_URL` environment variable.

#### Scenario: Real implementation calls device endpoint

- **WHEN** `auth login` initiates the device flow
- **THEN** the provider SHALL send a POST to `{baseUrl}/auth/device` with `{ client_id: "taskless-cli" }`
- **AND** the provider SHALL return the `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`, `expires_in`, and `interval` from the response

#### Scenario: Real implementation polls token endpoint

- **WHEN** the CLI polls for authorization
- **THEN** the provider SHALL send a POST to `{baseUrl}/auth/token` with `{ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code, client_id: "taskless-cli" }`
- **AND** the provider SHALL return the appropriate status (`pending`, `slow_down`, `success`, `expired`, or `denied`) based on the response

#### Scenario: Successful token response

- **WHEN** the token endpoint returns an `access_token`
- **THEN** the provider SHALL return a success result with the `access_token`, `token_type`, and `expires_in`

#### Scenario: Interface is swappable

- **WHEN** a different provider implementation is needed (e.g., for testing)
- **THEN** the provider SHALL be replaceable without changing the command logic

#### Scenario: API base URL is configurable

- **WHEN** `TASKLESS_API_URL` is set to `http://localhost:8787/cli`
- **THEN** the provider SHALL use that URL as the base for all auth endpoints

#### Scenario: API base URL defaults to production

- **WHEN** `TASKLESS_API_URL` is not set
- **THEN** the provider SHALL use `https://app.taskless.io/cli` as the base URL

#### Scenario: Network error during device flow

- **WHEN** the `fetch` call fails due to a network error (DNS, timeout, connection refused)
- **THEN** the provider SHALL throw an error with a descriptive message

#### Scenario: Non-200 response from device endpoint

- **WHEN** the device endpoint returns a non-200 status code
- **THEN** the provider SHALL throw an error indicating the request failed

### Requirement: CLI warns if .env.local.json is tracked by git

On any command that reads from `.taskless/.env.local.json`, the CLI SHALL check whether the file is tracked by git. If tracked, the CLI SHALL print a warning to stderr.

#### Scenario: .env.local.json is tracked

- **WHEN** the CLI reads `.taskless/.env.local.json` and the file is tracked by git (i.e., `git ls-files .taskless/.env.local.json` returns output)
- **THEN** the CLI SHALL print a warning to stderr: "Warning: .taskless/.env.local.json is tracked by git. This file contains authentication tokens and should be gitignored."

#### Scenario: .env.local.json is not tracked

- **WHEN** the CLI reads `.taskless/.env.local.json` and the file is not tracked by git
- **THEN** the CLI SHALL NOT print any warning

### Requirement: Auth error output uses standardized error envelope

When any `taskless auth` subcommand exits with an error AND `--json` was passed, the output SHALL conform to the standardized error envelope `{ "ok": false, "code": "<CODE>", "message": "<...>" }` per the `cli` capability requirements.

#### Scenario: Auth login network failure in JSON mode

- **WHEN** `taskless auth login --json` fails due to a network error
- **THEN** stdout SHALL contain `{ "ok": false, "code": "NETWORK_ERROR", "message": "..." }`
- **AND** the exit code SHALL be non-zero

### Requirement: Remote resolution reports which population a failure belongs to

Repository URL resolution SHALL distinguish three failure populations: the directory is not a git repository; the repository has no `origin` remote; the `origin` remote is not a GitHub URL. Each SHALL carry its own stable error code. The pre-existing `NO_GITHUB_REMOTE` code SHALL remain valid so consumers that branch on it keep working.

#### Scenario: Populations are distinguishable

- **WHEN** resolution fails in each of the three populations
- **THEN** each SHALL produce a distinct code
- **AND** a consumer SHALL determine the population from the code without parsing the message

#### Scenario: The existing code is retained

- **WHEN** this change ships
- **THEN** `NO_GITHUB_REMOTE` SHALL remain a member of the error-code contract

#### Scenario: Plain-text auth status is unchanged

- **WHEN** a user runs `taskless auth`
- **THEN** the output SHALL be the existing plain-text status
- **AND** no structured payload SHALL be added to this command

### Requirement: Token resolution prefers the environment over the saved token

When resolving the current authentication token, the CLI SHALL check in this order: (1) the `TASKLESS_TOKEN` environment variable, (2) `.taskless/.env.local.json` in the working directory. The first available token SHALL be used. A global `auth.json` under the XDG config directory SHALL NOT be used; if one exists, the CLI SHALL print a notice to stderr directing the user to `auth login` for the repository.

#### Scenario: Env var takes precedence over the saved token

- **WHEN** `TASKLESS_TOKEN` is set and `.taskless/.env.local.json` exists
- **THEN** the CLI SHALL use the `TASKLESS_TOKEN` value

#### Scenario: Saved token is used without the env var

- **WHEN** `TASKLESS_TOKEN` is not set and `.taskless/.env.local.json` holds an unexpired token
- **THEN** the CLI SHALL use the token from `.taskless/.env.local.json`

#### Scenario: A legacy global token is not used

- **WHEN** `TASKLESS_TOKEN` is not set, `.taskless/.env.local.json` does not exist, and a global `auth.json` exists
- **THEN** token resolution SHALL return undefined
- **AND** the CLI SHALL print a notice naming the legacy file

#### Scenario: No token available

- **WHEN** `TASKLESS_TOKEN` is not set and no `.env.local.json` exists
- **THEN** token resolution SHALL return undefined

### Requirement: Login stores the token only in the repository

The `taskless auth login` command SHALL store the auth token in `.taskless/.env.local.json` in the current repository, and nowhere else. The per-repo file SHALL be a JSON object containing the `access_token` and any additional OAuth response fields. The file SHALL be created with permissions `0600`.

#### Scenario: Login writes to per-repo .env.local.json

- **WHEN** a user runs `taskless auth login` in a git repository
- **THEN** the CLI SHALL write the token to `.taskless/.env.local.json` in the repository root
- **AND** the CLI SHALL ensure `.taskless/.gitignore` exists with `.env.local.json` listed

#### Scenario: Login does not write a global token

- **WHEN** a user runs `taskless auth login`
- **THEN** the CLI SHALL NOT write `auth.json` under the XDG config directory (`$XDG_CONFIG_HOME/taskless/` or `~/.config/taskless/`)

#### Scenario: .taskless/ directory is created if missing

- **WHEN** `.taskless/` does not exist in the repository root
- **THEN** the CLI SHALL create it before writing `.env.local.json`

### Requirement: A rejected token's message names a fix that works

When the service rejects the token (`401`), every message the CLI prints for it SHALL name a step that resolves it, chosen by where the token comes from:

- a saved token: run `auth login`, which replaces a token the service rejects;
- a token from `TASKLESS_TOKEN`: replace or unset the variable, stating that `auth login` and `auth logout` do not change it.

This SHALL hold for every command that reaches the service with a token, including `check`, `rule create`, `rule improve`, `rule restore`, `rule rollback`, `rule revisions`, and `taskless auth` status. The error code SHALL remain `AUTH_REQUIRED` wherever it is today.

`taskless auth` status SHALL distinguish a rejected token, with its remedy, from a service that could not be reached, and SHALL say "via TASKLESS_TOKEN" when that is the token's source.

#### Scenario: A saved token's rejection names auth login

- **WHEN** `TASKLESS_TOKEN` is not set and a command's request is answered `401`
- **THEN** the message SHALL name `auth login`
- **AND** the message SHALL NOT be only "Log in again."

#### Scenario: An environment token's rejection names the variable

- **WHEN** `TASKLESS_TOKEN` is set and a command's request is answered `401`
- **THEN** the message SHALL name `TASKLESS_TOKEN` and say to replace or unset it

#### Scenario: Status reports a rejected token with its remedy

- **WHEN** a user runs `taskless auth` and the service answers `401`
- **THEN** the output SHALL say the token was rejected and give the remedy

#### Scenario: Status does not call an unverified token invalid

- **WHEN** a user runs `taskless auth` and the service cannot be reached
- **THEN** the output SHALL say identity could not be verified
- **AND** SHALL NOT say the token is invalid or rejected

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
