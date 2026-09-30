# cli-rule-recovery Specification

## Purpose

How a rule Taskless issued is put back on disk after `check` reports it edited or missing (`rule restore`), or moved to an earlier revision (`rule rollback`): what each command asks the service for, how every served byte is verified before anything is written, and how a plan that does not include recovery is reported as an answer rather than a failure. `check` itself never does either.

## Requirements

### Requirement: Rule restore repairs a rule to its current revision

The CLI SHALL provide `taskless rule restore <ruleId>`, which requires authentication and a
resolvable repository. It SHALL snapshot and reconcile the rules tree exactly as `check` would,
read only the named rule's outcome, and act on it:

- `run` or withheld for entitlement: nothing to restore; say so and exit 0.
- `unknown`: say the rule was not issued for this repository and cannot be restored; exit non-zero.
- `unsafe` or `missing`: call `POST /cli/api/v2/rule/{ruleId}/restore` with `{ repositoryUrl, orgId? }`.

It SHALL NOT change any other rule.

#### Scenario: An edited rule is restored

- **WHEN** a user runs `taskless rule restore no-simply-1a2b3c4d` and reconcile returns `unsafe` for it
- **THEN** the CLI SHALL call restore for that rule
- **AND** after a verified write the next `check` SHALL reconcile it as `run`

#### Scenario: An intact rule is left alone

- **WHEN** reconcile returns `run` for the named rule
- **THEN** the CLI SHALL NOT call restore
- **AND** SHALL exit 0 saying the rule already matches an issued revision

#### Scenario: A locally written rule cannot be restored

- **WHEN** reconcile lists the named rule in `unknown`
- **THEN** the CLI SHALL exit non-zero saying the rule was not issued for this repository

### Requirement: Restore writes only what reconcile expected

Before writing a restored rule the CLI SHALL verify the served file set against its own
`signatures` (per `cli-generated-rule-delivery`) and against reconcile's expectation:

- for `unsafe`: the served signature map SHALL equal the local signature map with each reported
  file's `expected` applied and each `got`-only path removed;
- for `missing`: the served `revisionId` SHALL equal the verdict's `revisionId`.

On any mismatch it SHALL write nothing and exit non-zero, saying restore repairs a rule and does
not upgrade one.

#### Scenario: A newer revision is not written by restore

- **WHEN** the served set's signatures differ from reconcile's expected map for an `unsafe` rule
- **THEN** the CLI SHALL write nothing
- **AND** SHALL exit non-zero naming the rule

#### Scenario: A missing rule is restored to the revision reconcile named

- **WHEN** reconcile returns `missing` with `revisionId: "r1"` and restore serves `revisionId: "r1"` with valid signatures
- **THEN** the CLI SHALL write the rule directory

### Requirement: Rule rollback makes an earlier revision current

The CLI SHALL provide `taskless rule rollback <ruleId> <revisionId>`, which requires
authentication and a resolvable repository and calls
`POST /cli/api/v2/rule/{ruleId}/rollback` with `{ repositoryUrl, revisionId, orgId? }`. It SHALL
write the served set only when the served `revisionId` equals the requested one and every file
verifies against its signature. `404 revision_not_found` and `404 rule_not_found` SHALL each be
reported as such.

#### Scenario: Rollback writes the requested revision

- **WHEN** a user rolls rule `no-eval-3fa9c21b` back to revision `r1` and the server serves `r1` with valid signatures
- **THEN** the CLI SHALL replace the rule directory with the served set

#### Scenario: A different revision is refused

- **WHEN** rollback serves a `revisionId` other than the one requested
- **THEN** the CLI SHALL write nothing and exit non-zero

### Requirement: A plan refusal is an answer, not a failure of the service

When restore or rollback answers `200` with `restoreRules: false`, the CLI SHALL print the
response's `message` verbatim with C0 and C1 control characters other than newline removed, then
`upgradeUrl` when it is an absolute `https:` URL, and SHALL write nothing. It SHALL exit non-zero
with code `RULE_RECOVERY_NOT_IN_PLAN` and SHALL NOT describe the outcome as the service being
unavailable. An unrecognized `reason` SHALL be handled the same way.

#### Scenario: Free plan gets git guidance

- **WHEN** restore answers `{ restoreRules: false, reason: "RESTORE_RULES_NOT_IN_PLAN", message, upgradeUrl }`
- **THEN** the CLI SHALL print `message` and the upgrade URL
- **AND** SHALL exit non-zero with `RULE_RECOVERY_NOT_IN_PLAN`

#### Scenario: Control characters are stripped

- **WHEN** a refusal `message` contains an ANSI escape sequence
- **THEN** the printed message SHALL NOT contain the escape character

### Requirement: Recovery commands report under --json

Under `--json`, `rule restore` and `rule rollback` SHALL print
`{ success: true, ruleId, revisionId, files, notices? }` on success and the standardized error
envelope `{ ok: false, code, message }` otherwise, with `code` distinguishing
`RULE_RECOVERY_NOT_IN_PLAN`, `RULE_NOT_FOUND`, `REVISION_NOT_FOUND`, `RULE_RESTORE_MISMATCH`,
`AUTH_REQUIRED`, and `NETWORK_ERROR`.

#### Scenario: A refusal is machine-readable

- **WHEN** `rule restore --json` is refused for the plan
- **THEN** stdout SHALL be `{ ok: false, code: "RULE_RECOVERY_NOT_IN_PLAN", message }` with `message` carrying the server's guidance

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
make a listed revision current, unless the organization's plan is known to exclude rule
recovery, in which case it SHALL instead say that rolling back is not included in the plan.
The listing itself SHALL be the same either way.

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

#### Scenario: A plan known to exclude recovery is not told to roll back

- **WHEN** the organization's `restoreRules` entitlement is `false` and the service returns a listing
- **THEN** the CLI SHALL print the listing
- **AND** SHALL say that rolling back is not included in the plan, and SHALL NOT name `rule rollback`

#### Scenario: An unknown plan is told to roll back

- **WHEN** the organization's `restoreRules` entitlement is unknown and the service returns a listing
- **THEN** the CLI SHALL name `rule rollback <ruleId> <revisionId>`

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

### Requirement: Recovery suggestions follow the plan

The CLI SHALL read the acting organization's `entitlements.restoreRules` from the
`GET /cli/api/v2/whoami` response it already fetches to resolve the organization, and SHALL
NOT make another request for it. The value SHALL be treated as tri-state:

- `true`: the plan includes rule recovery.
- `false`: the plan is known to exclude rule recovery.
- unknown: whoami failed, the matched organization carried no `entitlements` or no boolean
  `restoreRules`, or no organization matched the repository's remotes and the CLI fell back
  to the token's claim.

Only `false` SHALL change what the CLI suggests. Wherever the CLI would name
`taskless rule restore <ruleId>` as the way to repair a rule (an `unsafe` or `missing` rule
reported by `check`, or the source of a rename), a `false` plan SHALL instead be told that
restoring rules is not included in the plan, and given git steps for the rule's directory
under `.taskless/rules/`: a `git log` command that lists the commits that changed it, and a
`git restore --source=<commit>` command that puts it back as of one of them. When the rule's
engine is not known, the directory SHALL be given as a pathspec matching the rule id under any
engine. `true` and unknown SHALL produce the suggestions the CLI produced before this
requirement.

This is a suggestion, never a gate. `rule restore` and `rule rollback` SHALL call the service
whatever `restoreRules` says, and SHALL relay a plan refusal as "A plan refusal is an answer,
not a failure of the service" requires. `--json` output SHALL NOT change.

#### Scenario: An edited rule on a plan without recovery gets git steps

- **WHEN** `check` reports sg rule `no-eval-3fa9c21b` as `unsafe` and `restoreRules` is `false`
- **THEN** the message SHALL say restoring rules is not included in the plan
- **AND** SHALL give `git log` and `git restore --source=<commit>` commands for `.taskless/rules/sg/no-eval-3fa9c21b/`
- **AND** SHALL NOT name `taskless rule restore`

#### Scenario: A missing rule of unknown engine gets a pathspec for any engine

- **WHEN** `check` reports rule `foo-1` as `missing` with no known engine and `restoreRules` is `false`
- **THEN** the git steps SHALL name a pathspec matching `foo-1` under any engine directory in `.taskless/rules/`

#### Scenario: A rename on a plan without recovery gets git steps for the source

- **WHEN** `check` reports vale rule `bar-2` as a copy of `foo-1`, `foo-1` is `missing`, and `restoreRules` is `false`
- **THEN** the message SHALL give the git steps for `foo-1`'s directory, then say to delete `.taskless/rules/vale/bar-2/`
- **AND** SHALL NOT name `taskless rule restore`

#### Scenario: Unknown keeps today's suggestion

- **WHEN** whoami fails, or the matched organization has no `entitlements`, or no organization matches the repository
- **THEN** every suggestion SHALL name `taskless rule restore <ruleId>` as before

#### Scenario: The entitlement never blocks a recovery command

- **WHEN** `restoreRules` is `false` and the user runs `taskless rule restore no-eval-3fa9c21b`
- **THEN** the CLI SHALL call the service's restore endpoint
- **AND** SHALL relay its refusal as it does today

#### Scenario: No extra request is made

- **WHEN** `check` or a `rule` subcommand resolves the acting organization
- **THEN** the CLI SHALL call `GET /cli/api/v2/whoami` at most once for that resolution
