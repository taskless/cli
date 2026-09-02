## ADDED Requirements

### Requirement: The reported file path is contractual

The CLI SHALL report each runtime check to reconcile as a **repo-root-relative POSIX path**,
`.taskless/rules/runtime/<id>/check.ts`, with platform separators normalized so every host
reports the same string for the same rule.

This is a cross-team contract, not an implementation detail. Reconcile matches `run` by content
digest and is path-independent, but the `unsafe` versus `unknown` split is a lookup on the
reported name: a spelling mismatch downgrades a tampered file from `unsafe` ("content changed in
place") to `unknown` ("never issued") — a diagnostic loss on the one path where the diagnosis
matters.

#### Scenario: The reported path is repo-relative and POSIX

- **WHEN** the CLI reports a runtime check to reconcile
- **THEN** the `file` SHALL be `.taskless/rules/runtime/<id>/check.ts`
- **AND** the separators SHALL be `/` regardless of host platform

### Requirement: A withheld rule can be re-fetched

When reconcile reports a rule as `unsafe` or `unknown`, the CLI SHALL be able to request the
blessed bytes for that rule rather than only warning. The request SHALL carry the rule id **and**
the signature the client holds, scoped like reconcile itself, so that a bare digest cannot be used
to retrieve content across organizations.

The response SHALL be the bytes matching the held signature, never the newest generation.
Answering with newer bytes would upgrade a rule in the middle of a `check` without anyone asking;
upgrading is regeneration and SHALL remain an explicit action.

#### Scenario: An unsafe rule is repaired

- **WHEN** reconcile reports a rule as `unsafe`
- **THEN** the CLI SHALL be able to re-fetch the blessed bytes for that rule
- **AND** the rule SHALL reconcile as `run` after the bytes are restored

#### Scenario: Re-fetch does not upgrade

- **WHEN** a newer generation of the same rule exists server-side
- **THEN** re-fetch SHALL still return the bytes matching the signature the client reported
