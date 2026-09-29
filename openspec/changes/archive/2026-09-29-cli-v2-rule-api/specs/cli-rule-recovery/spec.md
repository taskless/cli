## ADDED Requirements

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
