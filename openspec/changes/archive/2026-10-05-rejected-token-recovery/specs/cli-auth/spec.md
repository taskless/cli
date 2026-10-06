## MODIFIED Requirements

### Requirement: Auth login initiates Device Flow

`taskless auth login` initiates the device-code flow per the existing requirement. The new `--anonymous` flag (per the `cli` capability) SHALL NOT be accepted on this command — invocation with `--anonymous` SHALL exit with code 1 and an error message stating "auth commands cannot be anonymous".

When a token is already present, `auth login` SHALL decide by where it comes from:

- A token from `TASKLESS_TOKEN` SHALL be kept without contacting the service, since a saved login would not be used while the variable is set. The CLI SHALL name `TASKLESS_TOKEN` and SHALL NOT direct the user to `auth logout`, which cannot remove it.
- A saved token SHALL be checked with the service. If the service rejects it (`401`), the CLI SHALL run the device-code flow and replace the saved token. If the service accepts it, or cannot be reached, the CLI SHALL keep the token and report that the user is already logged in, since an unreachable service says nothing about the token.

Keeping a token SHALL NOT be an error: the command exits 0, and under `--json` prints nothing.

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

## REMOVED Requirements

### Requirement: Token is stored in XDG config directory

**Reason**: The CLI no longer writes or reads a global token. Tokens are stored per repository in `.taskless/.env.local.json`, and a leftover `auth.json` under the XDG config directory only produces a notice. The requirement described behavior the CLI has not had since that move.

**Migration**: None for users: the notice already tells anyone with a legacy file to run `auth login` in the repository. "Per-repository token storage in .env.local.json" now states that no global token is written.

### Requirement: Token resolution prefers per-repo over global

**Reason**: The global store is no longer a resolution source, and the requirement's title names it. A title is matched byte-for-byte when the change is archived, so it cannot be corrected by a MODIFIED block. It is removed and re-added as "Token resolution prefers the environment over the saved token".

**Migration**: None. The replacement keeps the environment-first order and the no-token result; the global fallback becomes a scenario stating the legacy file is not used.

### Requirement: Per-repository token storage in .env.local.json

**Reason**: Its scenario "Login also writes to global auth.json" is no longer true: login writes only the per-repo file. A MODIFIED block cannot drop a scenario, and the correction inverts it rather than editing it, so the requirement is removed and re-added as "Login stores the token only in the repository" with that scenario replaced by "Login does not write a global token".

**Migration**: None. The other scenarios carry over unchanged.

## ADDED Requirements

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
