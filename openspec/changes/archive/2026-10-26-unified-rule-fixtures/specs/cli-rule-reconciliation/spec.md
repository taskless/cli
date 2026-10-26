## MODIFIED Requirements

### Requirement: Canonical rule signature envelope

The CLI SHALL represent a rule file's canonical signature as a single self-describing
string of the form `<algoVersion>;h=<algo>;d=<digest>`. For algoVersion `1` this is
`1;h=sha-256;d=<hex>`, where `<hex>` is the digest as lowercase hexadecimal. The token
before the **first** `;` is the algoVersion and SHALL be read up to that one delimiter to
detect the version (and therefore the normalization procedure and hash algorithm) before
any `key=value` parameters are parsed. Signatures SHALL be compared as whole strings.

The algoVersion SHALL also determine **what one signature covers**. A signature at
algoVersion `1` covers exactly one file. **Which** files of a rule are signed is set by the
reconcile contract, not by the envelope: every file in the rule's directory except those
under `tests/` or the legacy `.tests/`, each with its own signature.

`.tests/` stays excluded beside `tests/` because migration 12 leaves in place any fixture it
cannot convert, and a leftover fixture reported as a rule file would make an issued rule read as
edited over a file that was never signed.

**Rationale.** Coverage per signature is a property of the signature scheme; the set of
signed files is a property of the rule contract. Keeping them apart is what lets the rule
contract grow from "`check.ts` only" to "every non-fixture file" without a new algoVersion,
because no single signature's meaning changed.

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

#### Scenario: A v1 signature covers exactly one file

- **WHEN** the CLI computes an algoVersion-1 signature for a rule
- **THEN** that signature SHALL be over one file's bytes and over no other file

#### Scenario: A v1 signature covers the engine's rule file

- **WHEN** a served runtime rule carries its singular `signature`
- **THEN** that signature SHALL be over `check.ts` and SHALL equal the `check.ts` entry in `signatures`

#### Scenario: Every non-fixture file of a rule is signed

- **WHEN** the CLI signs a rule directory for reconcile
- **THEN** it SHALL compute one signature per file in the directory
- **AND** SHALL NOT sign any file under `tests/` or `.tests/`

### Requirement: Reconcile reports every rule directory

When `check` reconciles, the CLI SHALL send `POST /cli/api/v2/reconcile` with
`{ repositoryUrl, orgId?, rules }`, where `rules` holds exactly one
`{ ruleId, files: [{ path, signature }] }` for **every** rule directory under
`.taskless/rules/<engine>/`, of every engine, whatever `--rule` selects to run. `ruleId`
SHALL be the directory name. `files` SHALL list every regular file under the directory,
recursively, except files under `tests/` or the legacy `.tests/` and the operating-system metadata files
`.DS_Store`, `Thumbs.db`, and `desktop.ini`. `path` SHALL be relative to the rule directory
with `/` separators on every platform, and `signature` SHALL be the full algoVersion-1
envelope of the snapshot's bytes for that file.

#### Scenario: Every engine is reported

- **WHEN** `.taskless/rules/sg/`, `.taskless/rules/vale/`, and `.taskless/rules/runtime/` each hold rules
- **THEN** the request SHALL carry one entry per rule directory across all three engines

#### Scenario: A rule's files are reported relative to its directory

- **WHEN** runtime rule `no-env-leak-3fa9c21b` holds `check.ts` and `captures/env.yml`
- **THEN** its entry SHALL be `{ ruleId: "no-env-leak-3fa9c21b", files: [{ path: "check.ts", … }, { path: "captures/env.yml", … }] }`

#### Scenario: Fixtures are not reported

- **WHEN** a rule directory holds files under `tests/`
- **THEN** no reported path SHALL begin with `tests/`

#### Scenario: Unconverted legacy fixtures are not reported

- **WHEN** a rule directory still holds files under `.tests/` that migration 12 could not convert
- **THEN** no reported path SHALL begin with `.tests/`
- **AND** the rule SHALL NOT read as edited because of them

#### Scenario: --rule does not narrow the report

- **WHEN** a user runs `check --rule a` in a project holding rules `a` and `b`
- **THEN** the reconcile request SHALL report both `a` and `b`
- **AND** only `a` SHALL run
