## ADDED Requirements

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

## MODIFIED Requirements

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
