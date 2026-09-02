# CLI Rule Reconciliation

## Purpose

Defines the CLI-side contract for server-owned rule reconciliation: how the CLI computes a canonical signature envelope for each rule file, how it calls the `POST /cli/api/reconcile` endpoint, and how it executes only the server's `run` set. The server-side record is authoritative; local signatures are advisory only.

## Requirements

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

### Requirement: Signature normalization procedure (algoVersion 1)

The CLI SHALL compute an algoVersion-1 digest as `SHA-256( normalize(fileText) )`,
hex-encoded lowercase, wrapped in the envelope. `normalize()` SHALL operate on raw decoded
text only and SHALL NOT parse or re-serialize YAML. In order, `normalize()` SHALL:

1. Decode the file as UTF-8.
2. Strip a single leading UTF-8 byte-order mark if present (decoded as `U+FEFF`).
3. Convert every CRLF and lone CR to LF.
4. Strip all trailing newlines, then append exactly one LF.
5. Re-encode as UTF-8 and SHA-256, hex lowercase.

The CLI SHALL NOT apply Unicode normalization (NFC/NFD): canonically-equivalent strings in
different composition forms SHALL hash differently. A change to `normalize()` SHALL ship as
a new algoVersion, never as a redefinition of an existing one.

#### Scenario: CRLF and LF hash identically

- **WHEN** two files differ only in CRLF versus LF line endings
- **THEN** their algoVersion-1 signatures SHALL be equal

#### Scenario: Trailing newlines are collapsed to one

- **WHEN** two files differ only in the number of trailing newlines (including none)
- **THEN** their algoVersion-1 signatures SHALL be equal

#### Scenario: Leading BOM is stripped

- **WHEN** a file has a leading UTF-8 BOM and an otherwise identical file does not
- **THEN** their algoVersion-1 signatures SHALL be equal

#### Scenario: Meaningful content change differs

- **WHEN** two files differ in any non-newline, non-BOM byte
- **THEN** their algoVersion-1 signatures SHALL differ

#### Scenario: Combining marks are not NFC-folded

- **WHEN** one file contains a precomposed character and another the decomposed form
- **THEN** their algoVersion-1 signatures SHALL differ

### Requirement: Signature hashing uses web-standard APIs only

The signature implementation SHALL use only web-standard APIs (`crypto.subtle.digest('SHA-256', …)`
and `TextEncoder`) and SHALL NOT depend on a Node-specific crypto module, so the CLI
reproduces the server's reference implementation byte-for-byte.

#### Scenario: No node-specific crypto dependency

- **WHEN** the signature module hashes a file's normalized bytes
- **THEN** it SHALL use `crypto.subtle` and `TextEncoder`
- **AND** SHALL NOT import `node:crypto`

### Requirement: Conformance vectors are fetched and asserted

The CLI SHALL consume the cross-repo conformance vectors served at
`GET /cli/api/rule-hash-vectors` (unauthenticated) as `{ vectors: [{ name, input, signature }] }`,
commit a copy as a fixture, and assert in its test suite that its independent
`normalize()`-plus-hash reproduces every vector's `signature` exactly. Non-ASCII `input`
SHALL be parsed as JSON (decoding `\uXXXX` escapes) before hashing. A vector mismatch SHALL
be a release blocker (the test SHALL fail the build).

#### Scenario: Local hasher reproduces every vector

- **WHEN** the conformance test runs against the committed vectors
- **THEN** the CLI SHALL compute the exact `signature` for every vector entry

#### Scenario: A mismatch blocks release

- **WHEN** any vector's computed signature does not match its expected `signature`
- **THEN** the test SHALL fail
- **AND** the build SHALL NOT pass

### Requirement: Reconcile reports every runtime rule's check.ts

Reconciliation SHALL be scoped to the **`check.ts` of runtime rules** — the only artifact that
carries arbitrary code execution. Static ast-grep rules and runtime-rule capture `*.yml` are
inert data, always available, and SHALL NOT be reported to or gated by reconciliation. The CLI
SHALL reconcile by sending `POST /cli/api/reconcile` with an `Authorization: Bearer <cli-token>`
header and a JSON body `{ repositoryUrl, files }`, where `repositoryUrl` is the full repository
URL and `files` is an array of `{ file, signature }` covering the `check.ts` of **every**
runtime rule the CLI holds under `.taskless/rules/runtime/`. `file` SHALL be the `check.ts`'s
delivered path as it exists on disk and `signature` SHALL be the full envelope computed for its
bytes. The CLI SHALL send the whole signature envelope, not a bare digest.

#### Scenario: Every runtime rule's check.ts is reported

- **WHEN** the CLI reconciles with runtime rules present under `.taskless/rules/runtime/`
- **THEN** the request body SHALL include one `{ file, signature }` entry for the `check.ts` of each runtime rule

#### Scenario: Inert files are not reported

- **WHEN** the CLI reconciles and static `*.yml` rules and capture `*.yml` are also present
- **THEN** the request body SHALL NOT include entries for those inert files
- **AND** the static rules SHALL run regardless of the reconcile response

#### Scenario: Full envelope is sent

- **WHEN** the CLI reports a file's signature
- **THEN** it SHALL send the complete `1;h=sha-256;d=<hex>` envelope, not only the digest

### Requirement: Reconcile response buckets drive execution

The reconcile response SHALL be interpreted as four buckets — `run`, `unsafe`, `unknown`,
and `missing` — and each SHALL drive a specific CLI action:

- `run`: the file's content matches a rule the server blessed. The CLI SHALL execute it. This
  is the complete allow-list.
- `unsafe`: a rule held by delivered name whose content differs from what the server blessed
  (`expected` vs `got`). The CLI SHALL NOT run it and SHALL surface it as tamper/drift.
- `unknown`: a reported file the server never issued. The CLI SHALL NOT run it and SHALL
  surface it as advisory.
- `missing`: a rule the server expected that the CLI did not report. It is not actionable for
  execution and SHALL be treated as advisory/audit only.

The CLI SHALL match each `run` entry back to a local file by its `signature` (content-based
join), so a file that was moved but not changed still resolves.

#### Scenario: Run entries are matched by signature

- **WHEN** the CLI processes a `run` entry
- **THEN** it SHALL locate the corresponding local file by matching the `signature`, not the path

#### Scenario: Unsafe is surfaced and not run

- **WHEN** a reported file lands in `unsafe`
- **THEN** the CLI SHALL NOT execute it
- **AND** SHALL surface it as tamper/drift

#### Scenario: Unknown is surfaced and not run

- **WHEN** a reported file lands in `unknown`
- **THEN** the CLI SHALL NOT execute it
- **AND** SHALL surface it as an advisory notice

#### Scenario: Missing is advisory only

- **WHEN** the response includes `missing` entries
- **THEN** the CLI SHALL treat them as advisory/audit only and SHALL NOT fail execution on them

### Requirement: The CLI executes only the server run set

When reconciliation succeeds, the CLI SHALL execute a runtime rule only if its **`check.ts`**
is present in the server's `run` set, and SHALL execute no runtime rule whose `check.ts` is
absent from `run`. The CLI SHALL NOT run a runtime rule on the basis of its own local
comparison of signatures. This replaces any local classification of runtime rules. Static
ast-grep rules and capture `*.yml` are outside this gate.

#### Scenario: Only rules with a blessed check.ts execute

- **WHEN** reconciliation returns a `run` set covering the `check.ts` of some runtime rules but not others
- **THEN** the CLI SHALL execute only the runtime rules whose `check.ts` is in `run`
- **AND** SHALL withhold any runtime rule whose `check.ts` is absent from `run`

#### Scenario: No local self-classification

- **WHEN** the CLI holds a local signature or sidecar for a runtime rule's `check.ts`
- **THEN** it SHALL NOT treat that local value as authorization to execute the rule

### Requirement: Reconcile is scoped to the token's organization

The reconcile endpoint SHALL be authorized by the same bearer-token / `orgId`-claim scheme as
all `/cli/api/*` endpoints and SHALL be scoped to the organization the token owns. The CLI
SHALL handle the documented edges: a `401` with `{ error: "unauthorized" }` for a missing or
invalid token; an empty corpus (empty `run`/`missing`, every reported file in `unknown`,
nothing runs); and an empty report (empty `run`/`unsafe`/`unknown`, the full corpus in
`missing`).

#### Scenario: Unauthorized token

- **WHEN** the CLI calls reconcile without a valid bearer token
- **THEN** the server SHALL return `401` with `{ error: "unauthorized" }`
- **AND** the CLI SHALL NOT execute any rule from a `run` set

#### Scenario: Empty corpus runs nothing

- **WHEN** the repository has no blessed rules and the CLI reports files
- **THEN** every reported file SHALL be returned in `unknown`
- **AND** the CLI SHALL execute nothing

### Requirement: Local signatures are advisory only

Any signature the CLI persists into the repository (for example as sidecar metadata) SHALL be
treated as an offline-fallback convenience only and SHALL NOT be treated as an authorization
signal. The server-side record is authoritative and the server decides what runs.

#### Scenario: Sidecar signature is not authorization

- **WHEN** a rule file has a locally stored signature that matches its content
- **THEN** the CLI SHALL NOT run the file on that basis alone
- **AND** SHALL rely on the server's `run` set for authorization

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
