## MODIFIED Requirements

### Requirement: Reconciliation survives the relayout

The CLI SHALL report each rule to the reconcile endpoint by its `ruleId` (the rule's directory
name) with file paths relative to the rule's own directory, so where the engine-partitioned
layout places a rule's directory is not part of what is reported. Moving a rule directory
without renaming or editing it SHALL NOT change its reconciled state.

#### Scenario: Moved rules reconcile unchanged

- **WHEN** `check` reconciles after the migration has moved rules into `.taskless/rules/<engine>/<id>/`
- **THEN** each rule is reported under the same `ruleId` with the same relative paths and signatures, the server resolves it to the same rule, and no rule is reported as new or missing

## ADDED Requirements

### Requirement: A served rule is filed under the engine it names

The CLI SHALL write a rule served by the v2 API into `.taskless/rules/<engine>/<id>/`, where
`<engine>` is the file set's own `engine`, which v2 always sends. If the set names an engine
the installed CLI does not know, the CLI SHALL refuse it with an error naming the engine and
directing the user to upgrade, SHALL write nothing under any engine directory, and SHALL NOT
fall back to ast-grep.

#### Scenario: A served rule lands under its engine

- **WHEN** a served file set declares engine `vale`
- **THEN** it is written under `.taskless/rules/vale/<id>/`

#### Scenario: An unrecognized engine fails loudly

- **WHEN** a served file set declares an engine the installed CLI does not support
- **THEN** the CLI exits with an error naming the engine and directing the user to upgrade, and no rule file is written under any engine directory

## REMOVED Requirements

### Requirement: Service-delivered rules without an engine are written as ast-grep

**Reason**: The default existed for the v1 payload, which could carry a single `content`
object with no engine. v2 always names the engine and never serves that envelope, and 0.12.0
calls only v2.
**Migration**: See "A served rule is filed under the engine it names".
