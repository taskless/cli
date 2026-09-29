## MODIFIED Requirements

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Rules create uses a network interface with stub

**Reason**: Describes a stub for the v1 routes that the CLI no longer calls.
**Migration**: The v2 calls are defined by "Rules create submits to API and polls for results"
and "Every API call is a v2 call carrying the CLI version".

### Requirement: Rule generation request endpoint accepts a request and returns a requestId

**Reason**: A v1 server route the CLI no longer calls. The v2 contract is owned by the server
(taskless/taskless#229) and vendored as `api-v2.schema.json`.
**Migration**: See `POST /cli/api/v2/request` in the vendored schema.

### Requirement: Iterate endpoint accepts guidance and returns a requestId

**Reason**: A v1 server route addressed by request id. v2 iterates by rule id.
**Migration**: See `POST /cli/api/v2/rule/{ruleId}/iterate` in the vendored schema.

### Requirement: Request status endpoint returns generation progress

**Reason**: The v1 status response carried rule content. v2 polling returns only
`{ ruleId, revisionId }` pairs.
**Migration**: See `GET /cli/api/v2/request/{requestId}` in the vendored schema.

### Requirement: Generated rule content follows ast-grep schema

**Reason**: Describes the legacy single `content` object, which v2 does not serve.
**Migration**: Every served rule is a file set (`cli-generated-rule-delivery`).

### Requirement: Generated rules may include test cases

**Reason**: Describes the legacy `tests` object beside `content`. v2 serves fixtures as files
under `.tests/`.
**Migration**: Every served rule is a file set (`cli-generated-rule-delivery`).
