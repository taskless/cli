# CLI Rules

## Purpose

Defines the `rules` subcommand group for the Taskless CLI, including `create`, `improve`, `delete`, and `meta` subcommands for managing ast-grep rules. Also documents the server-side API contract for rule generation endpoints.

## Requirements

### Requirement: Rules subcommand group exists

The CLI SHALL expose the rule operations under the `rule` (singular) subcommand group. The user-facing surface SHALL be `taskless rule create`, `taskless rule improve`, `taskless rule delete`, and `taskless rule meta`. Rule validation is not part of this group — it is addressed by path through the top-level `verify` and `test` commands, specified by the `cli-rule-validation` capability. The internal source filename (`packages/cli/src/commands/rules.ts`) MAY remain plural — only the user-visible subcommand name changes.

The previous plural form `taskless rules <subcommand>` SHALL NOT work in v0.7.0 — there is no compatibility alias.

#### Scenario: Singular subcommand registers correctly

- **WHEN** a user runs `taskless rule create --from req.json`
- **THEN** the CLI SHALL invoke the rule-create handler

#### Scenario: Plural subcommand is no longer recognized

- **WHEN** a user runs `taskless rules create --from req.json`
- **THEN** the CLI SHALL exit with an error indicating the subcommand is unknown
- **AND** the error message SHOULD suggest `taskless rule create`

### Requirement: Rules create reads request from stdin

The `taskless rule create` command SHALL accept a `--from <file>` flag specifying a JSON file containing the rule request. (Note: previously named `rules create`; renamed to singular.)

#### Scenario: rule create with --from file

- **WHEN** a user runs `taskless rule create --from .taskless/.tmp-rule-request.json --json`
- **THEN** the CLI SHALL read the JSON file and submit it to the API

### Requirement: Rules create resolves identity from JWT and git remote

`taskless rule create` SHALL resolve user identity from the stored JWT and the git remote per the existing identity resolution requirements. (Renamed to singular.)

When the git remote cannot yield a GitHub repository URL, the command SHALL fail with a code naming which population the project is in, and the failure SHALL be presented as a capability boundary on remote generation rather than as a broken repository or an authentication problem.

#### Scenario: Identity comes from the token and the remote

- **WHEN** an authenticated user runs `taskless rule create`
- **THEN** the CLI SHALL take the organization from the stored JWT
- **AND** it SHALL take the repository from the git remote rather than prompting for either

#### Scenario: The project is not a git repository

- **WHEN** an authenticated user runs `taskless rule create` in a directory that is not a git repository
- **THEN** the CLI SHALL fail with the code for that population
- **AND** the message SHALL state that remote generation is unavailable and name local authoring as the path that works

#### Scenario: The repository has no origin remote

- **WHEN** an authenticated user runs `taskless rule create` in a git repository with no `origin` remote
- **THEN** the CLI SHALL fail with the code for that population, distinct from the not-a-git-repository code

#### Scenario: The origin remote is not GitHub

- **WHEN** an authenticated user runs `taskless rule create` in a repository whose `origin` points at a non-GitHub host
- **THEN** the CLI SHALL fail with the code for that population, distinct from the other two
- **AND** the message SHALL state that only GitHub remotes are supported for remote generation

#### Scenario: A no-remote failure is not an auth failure

- **WHEN** any of the three no-remote populations fails `taskless rule create`
- **THEN** the emitted code SHALL NOT be `AUTH_REQUIRED`
- **AND** a consumer SHALL be able to distinguish the two without matching on message text

### Requirement: Rules create requires authentication

`taskless rule create` SHALL require authentication unless the new `--anonymous` flag is set. When `--anonymous` is set, the command SHALL invoke the local-only flow (see "Rule create supports anonymous local-only flow" below) instead of submitting to the API. (Renamed to singular; new anonymous branch.)

#### Scenario: rule create without --anonymous requires auth

- **WHEN** a user runs `taskless rule create --from req.json` without being logged in
- **THEN** the CLI SHALL exit with code 1 and an `AUTH_REQUIRED` error

#### Scenario: rule create --anonymous skips auth

- **WHEN** a user runs `taskless rule create --from req.json --anonymous` without being logged in
- **THEN** the CLI SHALL invoke the local-only flow without checking auth

### Requirement: Rules create submits to API and polls for results

`taskless rule create` without `--anonymous` SHALL submit the request to the API and poll for the result per the existing requirement. (Renamed to singular.)

#### Scenario: Submission returns a request to poll

- **WHEN** an authenticated user runs `taskless rule create` without `--anonymous`
- **THEN** the CLI SHALL submit the request to the API
- **AND** it SHALL poll for the result until the generation completes or fails

### Requirement: Rules create uses a network interface with stub

The API calls for rule generation (`POST /cli/api/request` and `GET /cli/api/request/:requestId`) SHALL be defined as a TypeScript interface. The initial implementation SHALL use a stub that returns an error indicating the API is not yet available. This allows the CLI UX to be built and tested independently of the API.

#### Scenario: Stub implementation returns an error

- **WHEN** `rule create` is run against the stub network layer
- **THEN** the stub SHALL return an error indicating rule generation is not yet available

#### Scenario: Interface is swappable

- **WHEN** the real API becomes available
- **THEN** the stub SHALL be replaceable with a real HTTP implementation without changing the command logic

### Requirement: Rules create writes rule files to disk

`taskless rule create` SHALL write the generated rule file into the rule's own directory, at `.taskless/rules/sg/<id>/<id>.yml`, regardless of whether `--anonymous` was set. The agent invoking the command SHALL NOT be expected to write rule files itself. (Renamed to singular; this strengthens the existing requirement to apply to both branches.)

#### Scenario: Both branches write rule files

- **WHEN** `taskless rule create` succeeds (with or without `--anonymous`)
- **THEN** `.taskless/rules/sg/<id>/<id>.yml` SHALL exist on disk

### Requirement: Rules create writes test files to disk

`taskless rule create` SHALL write generated test files into the rule's own directory, at `.taskless/rules/sg/<id>/.tests/`, regardless of whether `--anonymous` was set. (Renamed; strengthened; repathed for the rule-directory layout.)

#### Scenario: Tests land inside the rule they cover

- **WHEN** `taskless rule create` generates test cases for rule `<id>`
- **THEN** the CLI SHALL write them under `.taskless/rules/sg/<id>/.tests/`
- **AND** it SHALL do so whether or not `--anonymous` was set

### Requirement: Rules create outputs results

`taskless rule create` SHALL output results per the existing requirement. (Renamed to singular.) Output SHALL be human-readable by default; `--json` produces machine-readable output. On failure with `--json` set, the output SHALL be the standardized error envelope `{ ok: false, code: "<CODE>", message: "<...>" }` per the `cli` capability requirements.

#### Scenario: Failure under --json uses the error envelope

- **WHEN** `taskless rule create --json` fails
- **THEN** the CLI SHALL print `{ ok: false, code, message }` rather than prose

### Requirement: Rules create shows progress during polling

`taskless rule create` SHALL show progress while polling the API. The `--anonymous` branch polls nothing and SHOULD show progress for the local agent-driven steps where applicable. (Renamed to singular.)

#### Scenario: Polling reports progress

- **WHEN** `taskless rule create` is waiting on the API
- **THEN** the CLI SHALL report progress rather than appearing to hang

### Requirement: Rules improve reads request from file

`taskless rule improve` SHALL accept a `--from <file>` flag specifying a JSON file containing the iterate request. (Renamed to singular.)

#### Scenario: The request is read from the named file

- **WHEN** a user runs `taskless rule improve --from request.json`
- **THEN** the CLI SHALL read the iterate request from that file

### Requirement: Rules improve requires authentication

`taskless rule improve` SHALL require authentication unless `--anonymous` is set. (Renamed; new anonymous branch.)

#### Scenario: Authentication is required without --anonymous

- **WHEN** a logged-out user runs `taskless rule improve` without `--anonymous`
- **THEN** the CLI SHALL exit non-zero and direct the user to authenticate

#### Scenario: The anonymous branch skips authentication

- **WHEN** a logged-out user runs `taskless rule improve --anonymous`
- **THEN** the CLI SHALL run the local-only flow without requiring a login

### Requirement: Rules improve submits to iterate API and polls for results

`taskless rule improve` without `--anonymous` SHALL submit to the iterate API and poll for the result per the existing requirement. (Renamed.)

#### Scenario: Submission returns a request to poll

- **WHEN** an authenticated user runs `taskless rule improve` without `--anonymous`
- **THEN** the CLI SHALL submit to the iterate API
- **AND** it SHALL poll until the iteration completes or fails

### Requirement: Rules improve writes updated files to disk

`taskless rule improve` SHALL write updated rule files to disk in both branches. (Renamed; strengthened.)

#### Scenario: Both branches persist the updated rule

- **WHEN** `taskless rule improve` completes, with or without `--anonymous`
- **THEN** the CLI SHALL write the updated rule to its canonical location on disk

### Requirement: Rules improve outputs results

`taskless rule improve` SHALL output results per the existing requirement. (Renamed.) Failure output with `--json` SHALL use the standardized error envelope.

#### Scenario: Failure under --json uses the error envelope

- **WHEN** `taskless rule improve --json` fails
- **THEN** the CLI SHALL print `{ ok: false, code, message }`

### Requirement: Rules improve has an agent recipe

`taskless agent improve-rule` SHALL return the recipe per `cli-agent` requirements. The recipe file is `improve-rule.txt`, with an `improve-rule.anonymous.txt` variant for the local-only flow.

#### Scenario: The recipe resolves by its single-token name

- **WHEN** a user runs `taskless agent improve-rule`
- **THEN** the CLI SHALL print the contents of `improve-rule.txt`

### Requirement: Rules delete removes rule and test files

`taskless rule delete <id>` SHALL remove the rule and everything that defines it. Under the rule-directory layout that is one directory, `.taskless/rules/<engine>/<id>/`, which carries the rule, any per-engine config, and its tests. (Renamed; repathed.) Accepts `--anonymous` as a no-op.

A rule id does not carry its engine, so the CLI SHALL **resolve** which engine directory holds `<id>` rather than assuming one. A rule id is globally unique by construction, so at most one engine can hold it. When no engine holds the id, the CLI SHALL report not-found without naming an engine, because naming one would be a guess.

#### Scenario: Deleting a rule removes its whole directory

- **WHEN** a user runs `taskless rule delete no-eval`
- **THEN** the CLI SHALL remove the rule's directory including its `.tests/`
- **AND** no file belonging to that rule SHALL remain

#### Scenario: Deleting a rule filed under any engine

- **WHEN** a rule with id `<id>` exists under `.taskless/rules/vale/<id>/` or `.taskless/rules/runtime/<id>/`
- **THEN** `taskless rule delete <id>` SHALL remove that directory
- **AND** SHALL NOT report not-found for a rule that is present on disk

#### Scenario: Deleting an id no engine holds

- **WHEN** no engine directory contains `<id>`
- **THEN** the CLI SHALL report the rule was not found under `.taskless/rules/`
- **AND** the message SHALL NOT name a single engine's path

### Requirement: Rules delete does not require authentication

`taskless rule delete` SHALL NOT require authentication. Deleting a local file is not a service operation. (Renamed.)

#### Scenario: Deletion works logged out

- **WHEN** a logged-out user runs `taskless rule delete no-eval`
- **THEN** the CLI SHALL delete the rule without requiring a login

### Requirement: Rules delete accepts the id argument

`taskless rule delete <id>` SHALL accept the rule ID as a positional argument per the existing requirement. (Renamed.)

#### Scenario: The id is positional

- **WHEN** a user runs `taskless rule delete no-eval`
- **THEN** the CLI SHALL treat `no-eval` as the rule ID

### Requirement: Codegen script fetches official ast-grep rule schema

A codegen script (`packages/cli/scripts/fetch-ast-grep-schema.ts`) SHALL fetch the official ast-grep rule JSON Schema from GitHub and store it as a generated artifact committed to git. The schema version SHALL be pinned to the `@ast-grep/cli` version specified in `packages/cli/package.json`. The script is run manually via `pnpm generate:ast-grep-schema` when the ast-grep version is bumped.

#### Scenario: Codegen fetches schema from GitHub

- **WHEN** the codegen script is executed
- **THEN** it SHALL fetch `https://raw.githubusercontent.com/ast-grep/ast-grep/{VERSION}/schemas/rule.json` where `{VERSION}` is the `@ast-grep/cli` version from `packages/cli/package.json`
- **AND** write the result to `packages/cli/src/generated/ast-grep-rule-schema.json`

#### Scenario: Generated schema includes metadata comment

- **WHEN** the schema file is generated
- **THEN** it SHALL include a `$comment` field with the generation timestamp, ast-grep version, and source URL

#### Scenario: Generated schema is committed to git

- **WHEN** the codegen script completes
- **THEN** the generated file SHALL be committed to the repository alongside other generated artifacts in `packages/cli/src/generated/`

### Requirement: Schema version is pinned to ast-grep dependency

The codegen script SHALL extract the ast-grep version from `packages/cli/package.json` dependencies. The version extraction SHALL handle semver range prefixes (e.g., `^0.41.0` resolves to `0.41.0`).

#### Scenario: Version extracted from package.json

- **WHEN** `packages/cli/package.json` has `"@ast-grep/cli": "^0.41.0"` in dependencies
- **THEN** the codegen script SHALL fetch the schema for version `0.41.0`

#### Scenario: Codegen fails gracefully on network error

- **WHEN** the GitHub fetch fails (network error, 404, etc.)
- **THEN** the codegen script SHALL exit with a non-zero code and a descriptive error message
- **AND** SHALL NOT overwrite an existing generated schema file

### Requirement: The rule subcommand group no longer validates rules

`taskless rule verify` SHALL NOT exist. Rule validation is addressed by path through the top-level `verify` and `test` commands, specified by the `cli-rule-validation` capability.

#### Scenario: The removed subcommand does not resolve

- **WHEN** a user runs `taskless rule verify no-eval`
- **THEN** the CLI SHALL exit non-zero
- **AND** it SHALL NOT validate a rule

### Requirement: Generated schema is importable at build time

The generated JSON Schema file SHALL be importable by the CLI bundle via Vite. The import SHALL make the full JSON Schema object available at runtime without filesystem reads or network fetches.

#### Scenario: Schema imported in verify command

- **WHEN** the `verify` command needs the ast-grep schema
- **THEN** it SHALL import the schema from `../generated/ast-grep-rule-schema.json`
- **AND** the schema object SHALL be available synchronously at runtime

### Requirement: Rule create supports anonymous local-only flow

When `taskless rule create --anonymous` is invoked, the CLI SHALL execute the local-only rule-creation flow (previously implemented as the `taskless-create-rule-anonymous` skill body). The flow SHALL:

1. NOT submit any request to the Taskless API
2. Generate the ast-grep rule using local logic (Claude SDK, agent-driven generation, or whatever the migrated implementation prefers — see design.md)
3. Write the rule file to `.taskless/rules/sg/<id>/<id>.yml`
4. Write any generated test files into that rule's own directory, under `.taskless/rules/sg/<id>/.tests/`
5. NOT write a metadata sidecar (neither does the API-backed branch: the
   service never populates the `meta` block a sidecar would be written from,
   so no branch of `rule create` has ever written one)
6. Return the same output format as the API-backed branch (paths to created files)

#### Scenario: rule create --anonymous skips API

- **WHEN** a user runs `taskless rule create --from req.json --anonymous`
- **THEN** the CLI SHALL NOT make any HTTP request to the Taskless API
- **AND** SHALL produce a rule file under `.taskless/rules/`

#### Scenario: rule create --anonymous produces no metadata sidecar

- **WHEN** `taskless rule create --anonymous` succeeds
- **THEN** no file under `.taskless/rule-metadata/` SHALL be written for the new rule

### Requirement: Rule improve supports anonymous local-only flow

When `taskless rule improve --anonymous` is invoked, the CLI SHALL execute the local-only rule-improvement flow (previously implemented as the `taskless-improve-rule-anonymous` skill body). The flow SHALL:

1. NOT submit any request to the Taskless API iterate endpoint
2. Update the rule file in place using local logic
3. Support the verify feedback loop by exposing the top-level `verify` primitive that the agent invokes between edits
4. Return the same output format as the API-backed branch

#### Scenario: rule improve --anonymous skips API

- **WHEN** a user runs `taskless rule improve --from iterate.json --anonymous`
- **THEN** the CLI SHALL NOT make any HTTP request to the Taskless API
- **AND** SHALL update the target rule file

**API contract.** The requirements below describe the service endpoints the
`rule` subcommands call. They are grouped by a bold line rather than a
heading: a second `##` inside this section ends it, and everything after it
stops being read as a requirement.

### Requirement: Rule generation request endpoint accepts a request and returns a requestId

The server SHALL expose `POST /cli/api/rule` that accepts an authenticated request with a JSON body containing `orgId` (number, required), `repositoryUrl` (string, required), `prompt` (string, required), `successCases` (array of strings, optional), and `failureCases` (array of strings, optional). The endpoint SHALL return a JSON response containing `ruleId` (string) and `status` set to `"accepted"`.

#### Scenario: Valid request returns a ruleId

- **WHEN** an authenticated client sends a POST to `/cli/api/rule` with valid `orgId`, `repositoryUrl`, and `prompt`
- **THEN** the server SHALL return HTTP 200 with `{ ruleId: string, status: "accepted" }`

#### Scenario: Request with example arrays

- **WHEN** an authenticated client includes `successCases` and `failureCases` arrays
- **THEN** the server SHALL accept the arrays and use them for rule generation context

#### Scenario: Missing required fields

- **WHEN** a client sends a POST missing `orgId`, `repositoryUrl`, or `prompt`
- **THEN** the server SHALL return HTTP 400 with `{ error: "validation_error", details: string[] }`

#### Scenario: Unauthenticated request

- **WHEN** a client sends a POST without a valid `Authorization: Bearer <token>` header
- **THEN** the server SHALL return HTTP 401

#### Scenario: Repository not accessible

- **WHEN** the `repositoryUrl` is not accessible to the specified organization
- **THEN** the server SHALL return HTTP 403 with `{ error: "repository_not_accessible" }`

#### Scenario: Organization not found

- **WHEN** the `orgId` does not match a known organization
- **THEN** the server SHALL return HTTP 404 with `{ error: "organization_not_found" }`

### Requirement: Iterate endpoint accepts guidance and returns a requestId

The server SHALL expose `POST /cli/api/rule/{ruleId}/iterate` that accepts an authenticated request with a JSON body containing `orgId` (number, required), `guidance` (string, required), and `references` (array of `{ filename: string, content: string }`, optional). The endpoint SHALL return a JSON response containing `requestId` (string) and `status` set to `"accepted"`. The `requestId` SHALL be usable with the existing `GET /cli/api/rule/{requestId}` polling endpoint.

#### Scenario: Valid iterate request returns a requestId

- **WHEN** an authenticated client sends a POST to `/cli/api/rule/{ruleId}/iterate` with valid `orgId` and `guidance`
- **THEN** the server SHALL return HTTP 200 with `{ requestId: string, status: "accepted" }`

#### Scenario: Missing required fields

- **WHEN** a client sends a POST missing `orgId` or `guidance`
- **THEN** the server SHALL return HTTP 400 with `{ error: "validation_error", details: string[] }`

#### Scenario: Rule not found

- **WHEN** the `ruleId` does not match a known rule generation request
- **THEN** the server SHALL return HTTP 404 with `{ error: "request_not_found" }`

#### Scenario: Access denied

- **WHEN** the authenticated user does not have access to the specified rule
- **THEN** the server SHALL return HTTP 403 with `{ error: "access_denied" }`

#### Scenario: Organization not found

- **WHEN** the `orgId` does not match a known organization
- **THEN** the server SHALL return HTTP 404 with `{ error: "organization_not_found" }`

### Requirement: Request status endpoint returns generation progress

The server SHALL expose `GET /cli/api/request/:requestId` that accepts an authenticated request and returns the current status of the rule generation job. The status SHALL progress through `accepted` → `building` → `generated` (or `failed`).

#### Scenario: Generation accepted

- **WHEN** the rule generation job has been queued but not started
- **THEN** the server SHALL return `{ requestId, status: "accepted" }`

#### Scenario: Generation building

- **WHEN** the rule generation job is actively processing
- **THEN** the server SHALL return `{ requestId, status: "building" }`

#### Scenario: Generation complete

- **WHEN** the rule generation job has completed successfully
- **THEN** the server SHALL return `{ requestId, status: "generated", rules: GeneratedRule[] }`

#### Scenario: Generation failed

- **WHEN** the rule generation job has failed
- **THEN** the server SHALL return `{ requestId, status: "failed", error: string }`

#### Scenario: Unknown requestId

- **WHEN** a client requests a requestId that does not exist
- **THEN** the server SHALL return HTTP 404 with `{ error: "request_not_found" }`

#### Scenario: Access denied

- **WHEN** the authenticated user does not have access to the specified request
- **THEN** the server SHALL return HTTP 403 with `{ error: "access_denied" }`

#### Scenario: Unauthenticated request

- **WHEN** a client sends a GET without a valid `Authorization: Bearer <token>` header
- **THEN** the server SHALL return HTTP 401

### Requirement: Generated rule content follows ast-grep schema

Each rule in the `rules` array SHALL contain an `id` (string), a `content` object matching the ast-grep rule schema, and an optional `tests` object. The `content` object SHALL include at minimum `id` (string), `language` (string), and `rule` (object). It MAY include `severity`, `message`, `note`, `fix`, `constraints`, `utils`, `transform`, `metadata`, `files`, `ignores`, and `url`.

#### Scenario: Minimal rule content

- **WHEN** a rule is generated with minimal configuration
- **THEN** `content` SHALL contain `id`, `language`, and `rule`

#### Scenario: Full rule content

- **WHEN** a rule is generated with all optional fields
- **THEN** `content` SHALL contain all applicable fields from the ast-grep schema

### Requirement: Generated rules may include test cases

Each rule in the `rules` array MAY include a `tests` object. When present it SHALL contain `valid` (array of strings, code that must not trigger the rule) and `invalid` (array of strings, code that must trigger it).

#### Scenario: Rule with test cases

- **WHEN** the generator produces test cases for a rule
- **THEN** the rule SHALL include `tests` with non-empty `valid` and `invalid` arrays

#### Scenario: Rule without test cases

- **WHEN** the generator does not produce test cases
- **THEN** the `tests` field SHALL be absent or undefined

### Requirement: Whoami endpoint returns user identity and organizations

The server SHALL expose `GET /cli/api/whoami` that accepts an authenticated request and returns the user's identity and associated organizations.

#### Scenario: Authenticated user

- **WHEN** an authenticated client sends a GET to `/cli/api/whoami`
- **THEN** the server SHALL return `{ user: string, email?: string, orgs: [{ orgId: number, name: string, installationId: number }] }`

#### Scenario: Unauthenticated request

- **WHEN** a client sends a GET without a valid `Authorization: Bearer <token>` header
- **THEN** the server SHALL return HTTP 401 with `{ error: "unauthorized" }`

### Requirement: API manifest endpoint lists available endpoints

The server SHALL expose `GET /cli/api` that requires no authentication and returns an array of available CLI API endpoints with their paths, methods, and descriptions.

#### Scenario: Manifest is accessible without auth

- **WHEN** a client sends a GET to `/cli/api`
- **THEN** the server SHALL return HTTP 200 with an array of endpoint descriptors

### Requirement: API endpoints support schema introspection

All `/cli/api/*` endpoints SHALL support an `x-explain: 1` request header. When present, the endpoint SHALL return the JSON schema of its request/response instead of executing, and SHALL NOT require authentication.

#### Scenario: Schema introspection with x-explain header

- **WHEN** a client sends a request to any `/cli/api/*` endpoint with the `x-explain: 1` header
- **THEN** the server SHALL return the JSON schema for that endpoint's request and response
- **AND** the server SHALL NOT require authentication

### Requirement: Local rule generation requires no GitHub remote

Local rule authoring SHALL complete with no GitHub remote present, in all three no-remote populations. No local authoring path SHALL invoke identity resolution.

#### Scenario: Anonymous create in a non-git directory

- **WHEN** a user runs `taskless rule create --anonymous` in a directory that is not a git repository
- **THEN** the CLI SHALL complete without resolving identity and without a GitHub precondition error

#### Scenario: Anonymous create with a non-GitHub origin

- **WHEN** a user runs `taskless rule create --anonymous` in a repository whose `origin` is not GitHub
- **THEN** the CLI SHALL complete without resolving identity

#### Scenario: Verify and test never require a remote

- **WHEN** a user runs `taskless verify` or `taskless test` in any of the three no-remote populations
- **THEN** the command SHALL run to completion without a GitHub precondition error
