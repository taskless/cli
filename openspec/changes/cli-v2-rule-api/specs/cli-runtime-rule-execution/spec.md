## MODIFIED Requirements

### Requirement: Blessed runtime rules execute from the materialized run directory

When a runtime rule is executed on a validated path, the CLI SHALL execute it from the
snapshot `check` took at `.taskless/.run/rules/runtime/` **before** signing, not from the live
`.taskless/rules/runtime/` tree and not from a copy made after reconciliation, so the bytes
executed are exactly the bytes that were reported and judged (copy, sign, report, execute).

#### Scenario: Execution uses the blessed bytes

- **WHEN** a runtime rule is blessed and executed
- **THEN** the CLI SHALL invoke the `check.ts` in the snapshot under `.taskless/.run/rules/runtime/`
- **AND** SHALL NOT execute a copy modified in `.taskless/rules/runtime/` after reconciliation

#### Scenario: No copy is made between the verdict and execution

- **WHEN** a runtime rule's `check.ts` is edited in `.taskless/rules/runtime/` after the snapshot was signed and before execution
- **THEN** the executed `check.ts` SHALL be the snapshot's bytes that reconcile judged
