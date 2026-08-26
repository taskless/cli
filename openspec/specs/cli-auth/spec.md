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

#### Scenario: Standard login still works

- **WHEN** a user runs `taskless auth login`
- **THEN** the CLI SHALL initiate the device-code flow per the existing behavior

#### Scenario: Login rejects --anonymous

- **WHEN** a user runs `taskless auth login --anonymous`
- **THEN** the CLI SHALL exit with code 1
- **AND** SHALL print "auth commands cannot be anonymous" (or similar)

### Requirement: Auth logout removes saved token

`taskless auth logout` removes the saved token per the existing requirement. The `--anonymous` flag SHALL be accepted as a no-op on this command (logout is already a local operation requiring no API state).

#### Scenario: Standard logout still works

- **WHEN** a user runs `taskless auth logout`
- **THEN** the CLI SHALL remove the saved token per the existing behavior

#### Scenario: Logout accepts --anonymous as no-op

- **WHEN** a user runs `taskless auth logout --anonymous`
- **THEN** the CLI SHALL behave identically to `taskless auth logout`

### Requirement: Token is stored in XDG config directory

The CLI SHALL store the authentication token at `$XDG_CONFIG_HOME/taskless/auth.json`. If `$XDG_CONFIG_HOME` is not set, it SHALL default to `~/.config/taskless/auth.json`. The file SHALL be created with permissions `0600` (owner read/write only).

#### Scenario: Token file is created in default location

- **WHEN** `$XDG_CONFIG_HOME` is not set and a user logs in
- **THEN** the token SHALL be written to `~/.config/taskless/auth.json`
- **AND** the file permissions SHALL be `0600`

#### Scenario: Token file respects XDG_CONFIG_HOME

- **WHEN** `$XDG_CONFIG_HOME` is set to `/custom/config`
- **THEN** the token SHALL be written to `/custom/config/taskless/auth.json`

#### Scenario: Config directory is created if missing

- **WHEN** the `taskless/` directory does not exist under the config home
- **THEN** the CLI SHALL create it before writing the token file

### Requirement: Token file format

The token file (`auth.json`) SHALL be a JSON object containing at minimum an `access_token` field. It MAY contain additional fields returned by the OAuth token response (`token_type`, `expires_in`, `refresh_token`).

#### Scenario: Minimal token file

- **WHEN** the OAuth response contains only an access token
- **THEN** `auth.json` SHALL contain `{ "access_token": "<token>" }`

#### Scenario: Full token file

- **WHEN** the OAuth response contains access token, token type, and refresh token
- **THEN** `auth.json` SHALL contain all provided fields

### Requirement: Token resolution prefers per-repo over global

When resolving the current authentication token, the CLI SHALL check in this order: (1) `TASKLESS_TOKEN` environment variable, (2) `.taskless/.env.local.json` in the working directory, (3) global `~/.config/taskless/auth.json`. The first available token SHALL be used.

#### Scenario: Env var takes precedence over all files

- **WHEN** `TASKLESS_TOKEN` is set and both `.env.local.json` and global auth file exist
- **THEN** the CLI SHALL use the `TASKLESS_TOKEN` value

#### Scenario: Per-repo file takes precedence over global

- **WHEN** `TASKLESS_TOKEN` is not set, `.taskless/.env.local.json` exists, and global auth file exists
- **THEN** the CLI SHALL use the token from `.taskless/.env.local.json`

#### Scenario: Global file used as fallback

- **WHEN** `TASKLESS_TOKEN` is not set and `.taskless/.env.local.json` does not exist
- **THEN** the CLI SHALL use the token from the global auth file

#### Scenario: No token available

- **WHEN** `TASKLESS_TOKEN` is not set, no `.env.local.json` exists, and no global auth file exists
- **THEN** token resolution SHALL return undefined

### Requirement: Token resolution is a shared utility

A `getToken()` function SHALL exist that encapsulates the token resolution logic (env var check, then file read). All commands that need the current token SHALL use this function rather than reading the file directly.

#### Scenario: getToken returns env var value

- **WHEN** `TASKLESS_TOKEN` is set to `"test-token"`
- **THEN** `getToken()` SHALL return `"test-token"`

#### Scenario: getToken returns file token

- **WHEN** `TASKLESS_TOKEN` is not set and `auth.json` contains `{ "access_token": "file-token" }`
- **THEN** `getToken()` SHALL return `"file-token"`

#### Scenario: getToken returns null

- **WHEN** `TASKLESS_TOKEN` is not set and no token file exists
- **THEN** `getToken()` SHALL return `null`

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

### Requirement: Per-repository token storage in .env.local.json

The `taskless auth login` command SHALL store the auth token in `.taskless/.env.local.json` in the current repository, in addition to the existing global XDG config location. The per-repo file SHALL be a JSON object containing the `access_token` and any additional OAuth response fields. The file SHALL be created with permissions `0600`.

#### Scenario: Login writes to per-repo .env.local.json

- **WHEN** a user runs `taskless auth login` in a git repository
- **THEN** the CLI SHALL write the token to `.taskless/.env.local.json` in the repository root
- **AND** the CLI SHALL ensure `.taskless/.gitignore` exists with `.env.local.json` listed

#### Scenario: Login also writes to global auth.json

- **WHEN** a user runs `taskless auth login`
- **THEN** the CLI SHALL continue to write to the global XDG config location (`~/.config/taskless/auth.json`)
- **AND** the CLI SHALL write to `.taskless/.env.local.json` if in a git repository

#### Scenario: .taskless/ directory is created if missing

- **WHEN** `.taskless/` does not exist in the repository root
- **THEN** the CLI SHALL create it before writing `.env.local.json`

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
