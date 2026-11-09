## MODIFIED Requirements

### Requirement: Check subcommand exit codes reflect error severity

The CLI SHALL exit with code 0 when no error-severity matches are found (including when only warnings, info, or hints exist) and no reconcile outcome below requires failure. The CLI SHALL exit with code 1 when at least one error-severity match is found. The CLI SHALL also exit with code 1, whatever the findings and in both human and `--json` modes, when a completed reconcile:

- returned a non-empty `entitlement.withheld`;
- returned an `unsafe` verdict for a rule of any engine, runtime included;
- returned an `sg` or `vale` rule in `unknown` carrying `copyOf`, or a rule of any engine carrying a `copyOf` the CLI cannot read; or
- left a reported rule unaccounted for (in none, or more than one, of `rules`, `unknown`, and `entitlement.withheld`).

The CLI SHALL also exit with code 1 when reconcile was attempted and the rule service rejected the token (`401 unauthorized`), since a rejected token means no rule was verified on this or any later run until the token is replaced. The CLI SHALL likewise exit with code 1 when the rule service answered `cli_upgrade_required`, since a CLI version the service no longer supports verifies no rule on this or any later run until it is upgraded. A reconcile that could not complete for any other reason, including a rule service that could not be reached, SHALL NOT change the exit code.

On an authenticated run that would reconcile, the CLI SHALL also exit with code 1 when two rule directories under different engines share an id. A logged-out run verifies nothing and does not fail on it. Under `--json`, `success` SHALL be `false` whenever the exit code is non-zero.

#### Scenario: Exit 0 when clean

- **WHEN** the scanner produces zero results
- **THEN** the process SHALL exit with code 0

#### Scenario: Exit 0 when only warnings

- **WHEN** the scanner produces results but none have severity "error"
- **THEN** the process SHALL exit with code 0

#### Scenario: Exit 1 when errors found

- **WHEN** the scanner produces at least one result with severity "error"
- **THEN** the process SHALL exit with code 1

#### Scenario: Exit 1 when a runtime rule is withheld for entitlement

- **WHEN** reconciliation returns a non-empty `entitlement.withheld` and the scan produces zero results
- **THEN** the process SHALL exit with code 1
- **AND** under `--json`, `success` SHALL be `false`

#### Scenario: Entitlement without a withheld file does not fail

- **WHEN** reconciliation returns `entitlement.runtimeSignatures: false` with an empty or absent `withheld`, and the scan produces zero results
- **THEN** the process SHALL exit with code 0

#### Scenario: Exit 1 when a static rule was edited

- **WHEN** reconciliation returns an `unsafe` verdict for an `sg` or `vale` rule and the scan produces zero results
- **THEN** the process SHALL exit with code 1

#### Scenario: Exit 1 when a runtime rule was edited

- **WHEN** reconciliation returns an `unsafe` verdict for a runtime rule and the scan produces zero results
- **THEN** the process SHALL exit with code 1
- **AND** under `--json`, `failures` SHALL name the rule and `success` SHALL be `false`

#### Scenario: Exit 1 when the token is rejected

- **WHEN** an authenticated `check` attempts reconciliation and the rule service answers `401 unauthorized`
- **THEN** the process SHALL exit with code 1 whatever the scan found
- **AND** the failure SHALL say that authentication was rejected and no rule was verified

#### Scenario: Exit 1 when the CLI version is no longer supported

- **WHEN** an authenticated `check` attempts reconciliation and the rule service answers `cli_upgrade_required`
- **THEN** the process SHALL exit with code 1 whatever the scan found
- **AND** the failure SHALL say that the service no longer supports this CLI version and no rule was verified
- **AND** the notice SHALL name the command that upgrades the CLI

#### Scenario: An unreachable rule service does not fail

- **WHEN** an authenticated `check` attempts reconciliation and the rule service cannot be reached, or answers with a retryable status, and the scan produces zero results
- **THEN** the process SHALL exit with code 0

#### Scenario: Exit 1 when a static rule is a copy of an issued rule

- **WHEN** reconciliation returns an `sg` or `vale` rule in `unknown` with `copyOf`, and the scan produces zero results
- **THEN** the process SHALL exit with code 1

#### Scenario: Exit 1 when a reported rule is unaccounted for

- **WHEN** a reported rule appears in none of `rules`, `unknown`, and `entitlement.withheld`
- **THEN** the process SHALL exit with code 1

#### Scenario: Missing does not fail

- **WHEN** reconciliation returns only `run` and `missing` verdicts and the scan produces zero results
- **THEN** the process SHALL exit with code 0

### Requirement: Check degrades to a local scan when reconciliation cannot complete

`taskless check` SHALL NOT fail solely because an attempted reconciliation cannot complete,
with two exceptions: a `401` that rejects the token, and a `cli_upgrade_required` answer, fail
the run (see "Check subcommand exit codes reflect error severity"), because each is a fact about
this run's credentials or CLI version rather than an outage. When a token is available and `--anonymous` is not set but
reconciliation cannot complete (no resolvable git remote, the endpoint unreachable, a `401`, a
`404 organization_not_found`, a `cli_upgrade_required` answer, or a transport error), the CLI SHALL warn that rule verification could not be performed, SHALL run
every **static** rule from the snapshot unverified, and SHALL **skip runtime rules** unless
`--dangerously-run-scripts` is set. Except for a rejected token or a retired CLI version, the CLI SHALL NOT exit with a
non-zero code solely because reconciliation failed, and the warning SHALL be suppressed under
`--json`.

#### Scenario: Endpoint unreachable degrades static and skips runtime

- **WHEN** an authenticated `check` attempts reconciliation and the endpoint is unreachable or returns an error
- **THEN** the CLI SHALL warn that verification could not be performed
- **AND** SHALL scan all static rules
- **AND** SHALL NOT execute any runtime rule's `check.ts`
- **AND** SHALL NOT exit with a non-zero code solely due to the reconcile failure

#### Scenario: A rejected token degrades the same way and fails

- **WHEN** an authenticated `check` attempts reconciliation and the endpoint answers `401 unauthorized`
- **THEN** the CLI SHALL scan all static rules unverified
- **AND** SHALL NOT execute any runtime rule's `check.ts`
- **AND** SHALL exit with code 1

#### Scenario: A retired CLI version degrades the same way and fails

- **WHEN** an authenticated `check` attempts reconciliation and the endpoint answers `cli_upgrade_required`
- **THEN** the CLI SHALL scan all static rules unverified
- **AND** SHALL NOT execute any runtime rule's `check.ts`
- **AND** SHALL exit with code 1

#### Scenario: Degrade warning is suppressed under --json

- **WHEN** the CLI degrades and `--json` is set
- **THEN** stdout SHALL contain the machine JSON shape (`{ success, results }` plus the additive optional `skipped` array for the skipped runtime rules)
- **AND** SHALL NOT contain the human-readable degrade warning
