## ADDED Requirements

### Requirement: Rule revisions lists what rollback can choose from

The CLI SHALL provide `taskless rule revisions <ruleId>`, which requires authentication and a
resolvable repository and calls `GET /cli/api/v2/rule/{ruleId}/revisions` with
`repositoryUrl` and, when known, `orgId`. It SHALL write nothing to the working tree. It SHALL
NOT treat the plan as a precondition: the listing is served on every plan, so a plan without
rule recovery SHALL still get the list.

The CLI SHALL present the revisions in the order the service returns them and SHALL identify
the current revision by its `current` flag, never by its position, because the service appends
a current revision older than the newest ten after them. Human output SHALL show, for each
revision, its `revisionId`, `createdAt`, `delivery`, and `prUrl` when present, SHALL mark the
current one, and SHALL say when `truncated` is `true` that older revisions exist and are listed
on the Taskless dashboard. It SHALL name `rule rollback <ruleId> <revisionId>` as the way to
make a listed revision current.

`404 rule_not_found` SHALL be reported as `RULE_NOT_FOUND`, a rejected token as
`AUTH_REQUIRED`, and any other failure as `NETWORK_ERROR`.

#### Scenario: Revisions are listed with the current one marked

- **WHEN** the service returns revisions `r3`, `r2`, `r1` with `r2` current and `truncated: false`
- **THEN** the CLI SHALL list all three in that order and mark `r2` as current
- **AND** SHALL NOT say that older revisions were omitted

#### Scenario: A current revision older than the listed ones is still marked

- **WHEN** the service returns ten revisions none of which is current, followed by an eleventh with `current: true`
- **THEN** the CLI SHALL mark the eleventh as current

#### Scenario: A rule with no current revision marks none

- **WHEN** the service returns a single revision with `current: false`, delivered by a pull request that has not merged
- **THEN** the CLI SHALL list it with its `prUrl`, mark no revision as current, and say that the rule has no current revision until a pull request delivering it merges

#### Scenario: Truncation is reported

- **WHEN** the service returns `truncated: true`
- **THEN** the CLI SHALL say that older revisions exist and are listed on the Taskless dashboard

#### Scenario: A plan without recovery still lists revisions

- **WHEN** the organization's plan does not include rule recovery and the service returns a listing
- **THEN** the CLI SHALL print the listing and exit zero

#### Scenario: An unknown rule is reported as not found

- **WHEN** the service answers `404 rule_not_found`
- **THEN** the CLI SHALL exit non-zero with `RULE_NOT_FOUND`

### Requirement: Rule revisions reports under --json

Under `--json`, `rule revisions` SHALL print
`{ success: true, ruleId, revisions: [{ revisionId, createdAt, delivery, requestId, prUrl?, current }], truncated }`
on success, carrying each revision's fields as the service sent them, and the standardized
error envelope `{ ok: false, code, message }` otherwise.

#### Scenario: The listing is machine-readable

- **WHEN** `rule revisions no-eval-3fa9c21b --json` succeeds
- **THEN** stdout SHALL be a single JSON object with `success: true`, `ruleId: "no-eval-3fa9c21b"`, the `revisions` array, and `truncated`

#### Scenario: A failure is machine-readable

- **WHEN** `rule revisions --json` is answered `404 rule_not_found`
- **THEN** stdout SHALL be `{ ok: false, code: "RULE_NOT_FOUND", message }`
