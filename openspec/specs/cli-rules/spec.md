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

`taskless rule create` without `--anonymous` SHALL submit the request to
`POST /cli/api/v2/request`, poll `GET /cli/api/v2/request/{requestId}` until the request reaches
`generated`, `failed`, or `unsupported`, and then fetch each produced rule's head with
`GET /cli/api/v2/rule/{ruleId}` (without `revision`), in parallel, per the
`cli-generated-rule-delivery` capability. On `failed` or `unsupported` it SHALL print the
response's `error` as given.

#### Scenario: Submission returns a request to poll

- **WHEN** an authenticated user runs `taskless rule create` without `--anonymous`
- **THEN** the CLI SHALL submit the request to the API
- **AND** it SHALL poll for the result until the generation completes or fails

#### Scenario: Each produced rule is fetched by its id

- **WHEN** polling reaches `generated` with `revisions: [{ ruleId, revisionId }, …]`
- **THEN** the CLI SHALL fetch `GET /cli/api/v2/rule/{ruleId}` for each, without `revision`
- **AND** SHALL write each rule only after confirming its served `revisionId`

#### Scenario: A plan refusal is printed as given

- **WHEN** polling reaches `failed` or `unsupported` with an `error`
- **THEN** the CLI SHALL print that `error` verbatim (control characters stripped) and exit non-zero

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

`taskless rule create` SHALL output results human-readable by default; `--json` produces
machine-readable output `{ success, requestId, rules, files, notices? }`, where `requestId` is the
generation request id and `rules` lists the produced rule ids (their directory names). It SHALL
NOT emit a field named `ruleId`. On failure with `--json` set, the output SHALL be the
standardized error envelope `{ ok: false, code: "<CODE>", message: "<...>" }` per the `cli`
capability requirements.

#### Scenario: Failure under --json uses the error envelope

- **WHEN** `taskless rule create --json` fails
- **THEN** the CLI SHALL print `{ ok: false, code, message }` rather than prose

#### Scenario: Success under --json names the request and the rules

- **WHEN** `taskless rule create --json` produces rule `no-eval-3fa9c21b`
- **THEN** stdout SHALL include `requestId` and `rules: ["no-eval-3fa9c21b"]`
- **AND** SHALL NOT include `ruleId`

### Requirement: Rules create shows progress during polling

`taskless rule create` SHALL show progress while polling the API. The `--anonymous` branch polls nothing and SHOULD show progress for the local agent-driven steps where applicable. (Renamed to singular.)

#### Scenario: Polling reports progress

- **WHEN** `taskless rule create` is waiting on the API
- **THEN** the CLI SHALL report progress rather than appearing to hang

### Requirement: Rule generation tolerates transient service failures

While `taskless rule create` or `taskless rule improve` polls a submitted request, and while it
fetches the rules that request produced, an `unavailable` outcome marked `retryable` (a network
failure, `408`, `429`, or a `5xx`) SHALL NOT end the command. The CLI SHALL report the failure as
progress and try again after the poll interval, and SHALL give up only after 8 such outcomes in a
row. Any other answer SHALL reset that count. A non-retryable `unavailable` (an undocumented `4xx`
or a malformed body), a documented `error`, a refusal, or a `401` SHALL still fail on the first
occurrence. When the CLI gives up, the message SHALL name the request id, SHALL say the request
was not cancelled and may still complete, and SHALL name the `--resume` command that picks it up
again. All rules SHALL still be fetched before any is written, so a fetch that gives up writes
nothing.

#### Scenario: A transient run is ridden out

- **WHEN** polling answers `503`, `429`, and a network failure before reaching `generated`
- **THEN** the CLI SHALL keep polling and deliver the rules
- **AND** SHALL have submitted exactly one request

#### Scenario: Persistent failure gives up without implying a resubmit

- **WHEN** polling answers a retryable failure 8 times in a row
- **THEN** the CLI SHALL fail with `NETWORK_ERROR`
- **AND** the message SHALL name the request id, say it may still complete, and name
  `taskless rule <create|improve> --resume <requestId>`

#### Scenario: An answer in between resets the count

- **WHEN** polling answers 7 retryable failures, then `building`, then 7 more, then `generated`
- **THEN** the CLI SHALL deliver the rules

#### Scenario: A non-retryable failure fails at once

- **WHEN** polling answers an undocumented `4xx`, or `401`
- **THEN** the CLI SHALL fail on that answer without polling again

#### Scenario: Fetching a generated rule is retried the same way

- **WHEN** `GET /cli/api/v2/rule/{ruleId}` answers a retryable failure 8 times in a row
- **THEN** the CLI SHALL fail with `NETWORK_ERROR`, write no rules, and name the `--resume` command

### Requirement: Rules create and improve resume a submitted request

`taskless rule create` and `taskless rule improve` SHALL accept `--resume <requestId>`, the request
id a previous run of the same command printed. With it, the CLI SHALL NOT submit anything: it SHALL
poll that request and fetch, verify, and write what it produced exactly as it would have after
submitting it, and SHALL report the same output, with `requestId` set to the resumed id.
`--resume` SHALL NOT be combined with `--from`, and its value SHALL be a UUID; either mistake SHALL
fail with `INVALID_INPUT` before any service call.

#### Scenario: A resumed request is not resubmitted

- **WHEN** a user runs `taskless rule create --resume <requestId>` after a run that gave up on it
- **THEN** the CLI SHALL poll `GET /cli/api/v2/request/{requestId}` and write the produced rules
- **AND** SHALL NOT call `POST /cli/api/v2/request`

#### Scenario: Improve resumes without iterating again

- **WHEN** a user runs `taskless rule improve --resume <requestId>`
- **THEN** the CLI SHALL NOT call `POST /cli/api/v2/rule/{ruleId}/iterate`

#### Scenario: --resume with --from is refused

- **WHEN** a user runs `taskless rule create --resume <requestId> --from req.json`
- **THEN** the CLI SHALL fail with `INVALID_INPUT` without calling the service

#### Scenario: A rule id is not a request id

- **WHEN** a user runs `taskless rule improve --resume no-eval-3fa9c21b`
- **THEN** the CLI SHALL fail with `INVALID_INPUT` without calling the service

### Requirement: Rules improve reads request from file

`taskless rule improve` SHALL accept a `--from <file>` flag specifying a JSON file containing the
iterate request `{ ruleId, guidance, references? }`, where `ruleId` is the rule's directory name
under `.taskless/rules/<engine>/`, the id v2 addresses a rule by. (Renamed to singular.)

#### Scenario: The request is read from the named file

- **WHEN** a user runs `taskless rule improve --from request.json`
- **THEN** the CLI SHALL read the iterate request from that file

#### Scenario: The rule id is the directory name

- **WHEN** the request names `ruleId: "no-eval-3fa9c21b"`
- **THEN** the CLI SHALL iterate the rule at `.taskless/rules/<engine>/no-eval-3fa9c21b/`

### Requirement: Rules improve requires authentication

`taskless rule improve` SHALL require authentication unless `--anonymous` is set. (Renamed; new anonymous branch.)

#### Scenario: Authentication is required without --anonymous

- **WHEN** a logged-out user runs `taskless rule improve` without `--anonymous`
- **THEN** the CLI SHALL exit non-zero and direct the user to authenticate

#### Scenario: The anonymous branch skips authentication

- **WHEN** a logged-out user runs `taskless rule improve --anonymous`
- **THEN** the CLI SHALL run the local-only flow without requiring a login

### Requirement: Rules improve submits to iterate API and polls for results

`taskless rule improve` without `--anonymous` SHALL submit to
`POST /cli/api/v2/rule/{ruleId}/iterate`, poll the returned `requestId` exactly as `rule create`
does, and fetch and write the produced revision the same way. A `404 rule_not_found` SHALL be
reported as `RULE_NOT_FOUND`, not as a network error.

#### Scenario: Submission returns a request to poll

- **WHEN** an authenticated user runs `taskless rule improve` without `--anonymous`
- **THEN** the CLI SHALL submit to the iterate API
- **AND** it SHALL poll until the iteration completes or fails

#### Scenario: An unknown rule id is reported as such

- **WHEN** iterate answers `404` with `{ error: "rule_not_found" }`
- **THEN** the CLI SHALL fail with code `RULE_NOT_FOUND`

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

`taskless agent improve-rule` SHALL return the recipe per `cli-agent` requirements. The recipe file is `improve-rule.md`, with an `improve-rule.anonymous.md` variant for the local-only flow.

#### Scenario: The recipe resolves by its single-token name

- **WHEN** a user runs `taskless agent improve-rule`
- **THEN** the CLI SHALL print the contents of `improve-rule.md`

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

### Requirement: Whoami endpoint returns user identity and organizations

The server SHALL expose `GET /cli/api/v2/whoami` that accepts an authenticated request and returns
the user's identity and associated organizations, and the CLI SHALL call it rather than any v1
route.

#### Scenario: Authenticated user

- **WHEN** an authenticated client sends a GET to `/cli/api/v2/whoami`
- **THEN** the server SHALL return `{ user: string, email?: string, orgs: [{ orgId: number, id: string, name: string, source: "github", url: string }] }`

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

### Requirement: Every API call is a v2 call carrying the CLI version

Every Taskless API call the CLI makes outside `/cli/auth/*` SHALL go to a path under
`/cli/api/v2/` and SHALL carry the `x-taskless-cli-version` header with the running CLI's
version. The CLI SHALL NOT call any v1 data route.

#### Scenario: A v1 route is never called

- **WHEN** any command in this release talks to the Taskless API
- **THEN** the request path SHALL begin with `/cli/api/v2/` or `/cli/auth/`

#### Scenario: The version header is always sent

- **WHEN** the CLI calls any `/cli/api/v2/` route
- **THEN** the request SHALL carry `x-taskless-cli-version`
