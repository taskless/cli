## ADDED Requirements

### Requirement: The CLI reads the reconcile entitlement object

The CLI SHALL read the optional `entitlement` object on a successful reconcile response. It SHALL treat the organization as unentitled only when `entitlement.runtimeSignatures` is exactly `false`; an absent, malformed, or `true` value SHALL be treated as no entitlement outcome, leaving the four buckets to drive execution exactly as before. For an unentitled response the CLI SHALL read `reason`, `upgradeUrl`, and `withheld` (a list of `{ ruleId, file }`), SHALL drop a `withheld` entry without a string `file`, and SHALL surface `upgradeUrl` only when it is an absolute `https:` URL.

`entitlement.withheld` SHALL be a disposition distinct from the four buckets: a withheld file SHALL NOT be executed, SHALL NOT be surfaced as tamper, drift, or never-issued, and SHALL NOT be sent to restore. The CLI SHALL match a withheld entry to a local runtime rule by the `file` it reported, since the entry carries no signature. A withheld entry that matches no reported file SHALL still count as withheld for the purpose of the exit code.

#### Scenario: Absent entitlement changes nothing

- **WHEN** a reconcile response carries no `entitlement` object
- **THEN** the CLI SHALL drive execution from `run`, `unsafe`, `unknown`, and `missing` exactly as before

#### Scenario: Entitled response changes nothing

- **WHEN** a reconcile response carries `entitlement: { runtimeSignatures: true }`
- **THEN** the CLI SHALL drive execution from the four buckets exactly as before

#### Scenario: Withheld is matched by reported path

- **WHEN** `entitlement.withheld` lists `{ ruleId, file }` and `file` equals the path the CLI reported for a runtime rule's `check.ts`
- **THEN** the CLI SHALL classify that rule as withheld for entitlement and SHALL NOT execute it

#### Scenario: Withheld is not repaired

- **WHEN** a runtime rule is withheld for entitlement
- **THEN** the CLI SHALL NOT request a restore for it

#### Scenario: A malformed upgrade URL is not shown

- **WHEN** `entitlement.upgradeUrl` is not an absolute `https:` URL
- **THEN** the CLI SHALL omit it from human and `--json` output
