## MODIFIED Requirements

### Requirement: Reconciliation survives the relayout

The CLI SHALL report each rule to the reconcile endpoint by its `ruleId` (the rule's directory
name) with file paths relative to the rule's own directory, so where the engine-partitioned
layout places a rule's directory is not part of what is reported. Moving a rule directory
without renaming or editing it SHALL NOT change its reconciled state.

#### Scenario: Moved rules reconcile unchanged

- **WHEN** `check` reconciles after the migration has moved rules into `.taskless/rules/<engine>/<id>/`
- **THEN** each rule is reported under the same `ruleId` with the same relative paths and signatures, the server resolves it to the same rule, and no rule is reported as new or missing
