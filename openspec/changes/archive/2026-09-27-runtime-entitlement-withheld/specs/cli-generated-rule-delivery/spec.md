## ADDED Requirements

### Requirement: A runtime rule written under a plan without runtime signatures says it will not run

When the CLI writes a runtime rule from a response whose `entitlement.runtimeSignatures` is exactly `false` (from `rule create`, `rule improve`, or a restore during `check`), it SHALL still write the rule, and SHALL emit a warning that the rule is on disk but will not run on the organization's current plan, including the `upgradeUrl` when it is an absolute `https:` URL. The warning SHALL be carried in the command's existing notices, so it appears in human output and under `--json`. A restore under such a response SHALL NOT state or imply that the next `check` will bless or run the rule. A response with no `entitlement` object, or with `runtimeSignatures: true`, SHALL produce no such warning.

#### Scenario: Created runtime rule under an unentitled plan

- **WHEN** `rule create` receives a generated runtime rule with `entitlement.runtimeSignatures: false`
- **THEN** the CLI SHALL write the rule
- **AND** SHALL warn that it will not run on the current plan
- **AND** under `--json` the warning SHALL appear in `notices`

#### Scenario: Restore under an unentitled plan does not promise blessing

- **WHEN** a restore during `check` writes a runtime rule and the restore response carries `entitlement.runtimeSignatures: false`
- **THEN** the restore notice SHALL say the rule's bytes were restored but will not run on the current plan
- **AND** SHALL NOT say the next `check` blesses it

#### Scenario: Entitled or legacy responses do not warn

- **WHEN** a runtime rule is written from a response with no `entitlement` object or with `runtimeSignatures: true`
- **THEN** the CLI SHALL emit no entitlement warning

#### Scenario: Static rules never warn

- **WHEN** `rule create` writes an `sg` or `vale` rule
- **THEN** the CLI SHALL emit no entitlement warning
