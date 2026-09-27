## MODIFIED Requirements

### Requirement: Check subcommand exit codes reflect error severity

The CLI SHALL exit with code 0 when no error-severity matches are found (including when only warnings, info, or hints exist) and no runtime rule was withheld for entitlement. The CLI SHALL exit with code 1 when at least one error-severity match is found. The CLI SHALL also exit with code 1 when reconciliation completed and the response's `entitlement.withheld` is non-empty, whatever the findings, in both human and `--json` modes.

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

## ADDED Requirements

### Requirement: Check reports runtime rules withheld for entitlement as a plan outcome

When reconciliation completes and returns a non-empty `entitlement.withheld`, `taskless check` SHALL NOT execute any withheld rule, SHALL report each local runtime rule whose reported `check.ts` path appears in `withheld` as skipped with a reason stating that runtime rules are not included in the organization's plan, and SHALL NOT describe it as unsafe, unknown, drifted, or tampered. The human output SHALL include one notice naming the withheld rules, the `entitlement.reason`, and the `entitlement.upgradeUrl` when present. Under `--json`, the output SHALL carry an additive, optional `entitlement` object with `runtimeSignatures`, `reason`, `upgradeUrl`, and `withheld` (the local rule names), present only when reconciliation returned `runtimeSignatures: false`. This is a verified outcome and SHALL NOT be treated as one of the unverified paths that leave the exit code unchanged.

#### Scenario: Withheld rule is named with its cause

- **WHEN** an authenticated `check` reconciles and `entitlement.withheld` lists the reported `check.ts` of runtime rule `no-env-leak`
- **THEN** `no-env-leak` SHALL NOT execute
- **AND** its skip reason SHALL state that runtime rules are not included in the plan
- **AND** its skip reason SHALL NOT mention unsafe, unknown, or drift

#### Scenario: Upgrade URL is shown once

- **WHEN** two runtime rules are withheld and `entitlement.upgradeUrl` is present
- **THEN** the human output SHALL print the upgrade URL exactly once, in one notice naming both rules and the reason

#### Scenario: Entitlement appears under --json

- **WHEN** a runtime rule is withheld and `--json` is set
- **THEN** stdout SHALL include `entitlement` with `runtimeSignatures: false`, `reason`, `upgradeUrl`, and `withheld` naming the rule
- **AND** `skipped` SHALL still list the rule with its plan reason

#### Scenario: A server without the entitlement object is unchanged

- **WHEN** reconciliation returns the four arrays and no `entitlement` object
- **THEN** `check` SHALL behave exactly as before this change, including its exit code and skip reasons

#### Scenario: Degrade paths still never fail

- **WHEN** `check` runs logged out, with `--anonymous`, or reconciliation cannot complete
- **THEN** the exit code SHALL NOT change because runtime rules were skipped, as before this change
