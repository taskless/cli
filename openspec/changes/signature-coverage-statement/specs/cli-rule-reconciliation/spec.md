## MODIFIED Requirements

### Requirement: Canonical rule signature envelope

The CLI SHALL represent a rule file's canonical signature as a single self-describing
string of the form `<algoVersion>;h=<algo>;d=<digest>`. For algoVersion `1` this is
`1;h=sha-256;d=<hex>`, where `<hex>` is the digest as lowercase hexadecimal. The token
before the **first** `;` is the algoVersion and SHALL be read up to that one delimiter to
detect the version (and therefore the normalization procedure and hash algorithm) before
any `key=value` parameters are parsed. Signatures SHALL be compared as whole strings.

The algoVersion SHALL also determine **what the signature covers**. A signature at
algoVersion `1` covers exactly one file: the engine's `ruleFile` from the rule layout
table, which is `check.ts` for the runtime engine. An engine that requires more than one
file to be signed SHALL do so under a later algoVersion.

**Rationale.** Coverage is a property of the signature scheme, not of the delivery that
carries a signature. Stating it on the version keeps a payload from having to say which
of its files is the signed one, and gives a future multi-file scheme a mechanism that
already exists rather than a new payload shape. Leaving it unstated is what let both
teams hold the same binding as a private assumption.

#### Scenario: Envelope is emitted for algoVersion 1

- **WHEN** the CLI computes a signature for a rule file's bytes using algoVersion 1
- **THEN** the signature SHALL be the string `1;h=sha-256;d=<hex>` for that file's normalized bytes

#### Scenario: Version is read before parameters

- **WHEN** the CLI parses a signature string
- **THEN** it SHALL read the algoVersion as the substring before the first `;`
- **AND** SHALL NOT rely on the `key=value` parameter syntax to determine the version

#### Scenario: Signatures compare as whole strings

- **WHEN** the CLI compares two signatures for equality
- **THEN** it SHALL compare the full envelope strings, not the bare digests

#### Scenario: A v1 signature covers the engine's rule file

- **WHEN** a runtime rule carries a signature at algoVersion 1
- **THEN** that signature SHALL be over `check.ts` and over no other file in the rule directory
