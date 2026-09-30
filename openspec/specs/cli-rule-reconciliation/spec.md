# CLI Rule Reconciliation

## Purpose

Defines the CLI-side contract for server-owned rule reconciliation: how the CLI computes a canonical signature envelope for each file of a rule, how it reports every rule of every engine to `POST /cli/api/v2/reconcile` from a snapshot it then runs, and how it applies the per-rule verdicts, accounts for every rule it reported, and reads the plan entitlement. The server-side record is authoritative; local signatures are advisory only.

## Requirements

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
under `.tests/`, each with its own signature.

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
- **AND** SHALL NOT sign any file under `.tests/`

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
`GET /cli/api/v2/rule-hash-vectors` (unauthenticated) as `{ vectors: [{ name, input, signature }] }`,
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

#### Scenario: Vectors come from the v2 surface

- **WHEN** the build refreshes the committed vectors
- **THEN** it SHALL fetch `GET /cli/api/v2/rule-hash-vectors`
- **AND** SHALL NOT call a v1 route

### Requirement: Reconcile is scoped to the token's organization

The reconcile endpoint SHALL be authorized by the bearer token and SHALL be scoped to the
organization named by the optional `orgId` (a Taskless org UUID, preferred, or a numeric
GitHub org id) or, when absent, by the token. The CLI SHALL handle the documented edges: a
`401` with `{ error: "unauthorized" }` for a missing or invalid token; a `404` with
`{ error: "organization_not_found" }` when the organization is not accessible or the
repository is not covered by its installation (deliberately indistinguishable); an empty
corpus (every reported rule in `unknown`, nothing runs on a verdict); and an empty report
(every issued rule in `missing`).

#### Scenario: Unauthorized token

- **WHEN** the CLI calls reconcile without a valid bearer token
- **THEN** the server SHALL return `401` with `{ error: "unauthorized" }`
- **AND** the CLI SHALL NOT execute any runtime rule on the basis of that call

#### Scenario: Empty corpus runs nothing

- **WHEN** the repository has no issued rules and the CLI reports rules
- **THEN** every reported rule SHALL be returned in `unknown`
- **AND** the CLI SHALL execute no runtime rule

#### Scenario: Organization not found is not a service outage

- **WHEN** reconcile answers `404` with `{ error: "organization_not_found" }`
- **THEN** the CLI SHALL name both causes (the installation does not cover this repository, or the login lost access)
- **AND** SHALL treat the run as unverified rather than as a verdict

### Requirement: Local signatures are advisory only

Any signature the CLI persists into the repository (for example as sidecar metadata) SHALL be
treated as an offline-fallback convenience only and SHALL NOT be treated as an authorization
signal. The server-side record is authoritative and the server decides what runs.

#### Scenario: Sidecar signature is not authorization

- **WHEN** a rule file has a locally stored signature that matches its content
- **THEN** the CLI SHALL NOT run the file on that basis alone
- **AND** SHALL rely on the server's `run` set for authorization

### Requirement: Reconcile reports every rule directory

When `check` reconciles, the CLI SHALL send `POST /cli/api/v2/reconcile` with
`{ repositoryUrl, orgId?, rules }`, where `rules` holds exactly one
`{ ruleId, files: [{ path, signature }] }` for **every** rule directory under
`.taskless/rules/<engine>/`, of every engine, whatever `--rule` selects to run. `ruleId`
SHALL be the directory name. `files` SHALL list every regular file under the directory,
recursively, except files under `.tests/` and the operating-system metadata files
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

- **WHEN** a rule directory holds files under `.tests/`
- **THEN** no reported path SHALL begin with `.tests/`

#### Scenario: --rule does not narrow the report

- **WHEN** a user runs `check --rule a` in a project holding rules `a` and `b`
- **THEN** the reconcile request SHALL report both `a` and `b`
- **AND** only `a` SHALL run

### Requirement: Rule ids are unique across engines

Before reconciling, the CLI SHALL refuse the run when two rule directories under different
engines share a directory name, naming both directories. It SHALL NOT report either rule
and SHALL NOT resolve the collision by skipping one of them.

#### Scenario: A duplicate id stops the run

- **WHEN** both `.taskless/rules/sg/foo-3fa9c21b/` and `.taskless/rules/vale/foo-3fa9c21b/` exist
- **THEN** `check` SHALL exit non-zero naming both directories
- **AND** SHALL NOT call reconcile

#### Scenario: A decoy cannot neutralize an issued rule

- **WHEN** someone creates a directory under a second engine with the id of an issued rule
- **THEN** the issued rule SHALL NOT run as though it were locally authored

### Requirement: Reconcile verdicts are applied per engine

The CLI SHALL read the v2 reconcile response as a list of per-rule verdicts
(`rules[]`, each `{ ruleId, engine, verdict }` with `verdict` one of `run`, `unsafe`,
`missing`), a list of `unknown` rules (each `{ ruleId, copyOf? }`), and
`entitlement.withheld`, and SHALL apply this policy:

| Verdict              | runtime                                            | sg / vale                                     |
| -------------------- | -------------------------------------------------- | --------------------------------------------- |
| `run`                | execute                                            | run                                           |
| `withheld`           | do not execute; fail `check`                       | (never sent)                                  |
| `unsafe`             | do not execute; name `rule restore`                | do not run; fail `check`; name `rule restore` |
| `missing`            | warn; name `rule restore`                          | warn; name `rule restore`                     |
| `unknown`            | do not execute (needs `--dangerously-run-scripts`) | run                                           |
| `unknown` + `copyOf` | do not execute; name the source                    | do not run; fail `check`; name the source     |

The engine SHALL be taken from the verdict's `engine` for `rules[]` entries and from the
reporting directory for `unknown` entries. An `unsafe` notice SHALL name the rule and each
differing path, saying whether it changed, was removed, or was added. A signature SHALL
authorize running a runtime rule only through a `run` verdict, never by local comparison.

#### Scenario: An edited static rule fails and does not run

- **WHEN** reconcile returns `{ ruleId: "no-simply-1a2b3c4d", engine: "vale", verdict: "unsafe", files: [{ path: ".vale.ini", expected, got }] }`
- **THEN** the rule SHALL NOT run
- **AND** `check` SHALL exit non-zero naming the rule and `.vale.ini` as changed

#### Scenario: A locally written static rule runs

- **WHEN** reconcile lists a static rule's id in `unknown` without `copyOf`
- **THEN** that rule SHALL run
- **AND** the CLI SHALL emit no notice for it

#### Scenario: A locally written runtime rule does not execute

- **WHEN** reconcile lists a runtime rule's id in `unknown` and `--dangerously-run-scripts` is not set
- **THEN** the rule SHALL NOT execute
- **AND** its skip reason SHALL say it was not issued by the rule service

#### Scenario: Missing warns and does not fail

- **WHEN** reconcile returns a `missing` verdict for any engine, and no `unknown` rule names it in `copyOf`
- **THEN** the CLI SHALL warn naming the rule and `taskless rule restore <ruleId>`
- **AND** SHALL NOT change the exit code because of it

#### Scenario: An edited runtime rule is withheld, not failed

- **WHEN** reconcile returns an `unsafe` verdict for a runtime rule
- **THEN** the rule SHALL NOT execute
- **AND** the exit code SHALL NOT change because of that verdict alone

### Requirement: Every reported rule is accounted for

After a reconcile completes, every `ruleId` the CLI reported SHALL appear in exactly one of
`rules[]`, `unknown[]`, or `entitlement.withheld[]`. A reported rule that appears in none,
or in more than one, SHALL be treated as unaccounted: it SHALL NOT run or execute, and
`check` SHALL fail naming it. `missing` verdicts name rules that were not reported and are
outside this check.

#### Scenario: A dropped rule fails the run

- **WHEN** the CLI reports rule `a` and the response names `a` in none of `rules`, `unknown`, or `entitlement.withheld`
- **THEN** `a` SHALL NOT run
- **AND** `check` SHALL exit non-zero naming `a`

#### Scenario: A rule answered twice fails the run

- **WHEN** a reported rule appears both in `rules[]` and in `entitlement.withheld`
- **THEN** it SHALL NOT run
- **AND** `check` SHALL exit non-zero naming it

### Requirement: The CLI runs the bytes it reported

Before signing anything, `check` SHALL copy `.taskless/rules/` into a snapshot inside its own
run directory under `.taskless/.run/` (per the `cli-check` capability), dereferencing symbolic
links.
It SHALL compute every reported signature from the snapshot and SHALL run every engine
from the snapshot, with the assembled configs written under `.taskless/.run/`. A rule the
verdict excludes SHALL be removed from the snapshot before any engine configuration is
assembled. The snapshot SHALL be taken on every path, including unauthenticated and
`--anonymous` runs.

#### Scenario: An edit after signing does not run

- **WHEN** a rule file under `.taskless/rules/` is edited after `check` has signed the snapshot
- **THEN** the engines SHALL run the snapshot's bytes, not the edited file

#### Scenario: Static rules run from the snapshot

- **WHEN** `check` runs sg and vale rules
- **THEN** the ast-grep and Vale configs SHALL point into the snapshot under `.taskless/.run/`
- **AND** SHALL NOT point into `.taskless/rules/`

#### Scenario: An excluded rule is absent from what runs

- **WHEN** a static rule's verdict is `unsafe`
- **THEN** its directory SHALL be absent from the snapshot the engines read

### Requirement: The CLI reads the v2 reconcile entitlement

The CLI SHALL read the reconcile response's `entitlement` object, which v2 always sends. It
SHALL treat the organization as unentitled only when `entitlement.runtimeSignatures` is
exactly `false`, SHALL read `reason`, `upgradeUrl`, and `withheld` as a list of
`{ ruleId, revisionId }`, SHALL match a withheld entry to a reported rule by `ruleId`, and
SHALL surface `upgradeUrl` only when it is an absolute `https:` URL. A withheld entry SHALL
NOT be dropped for lacking any field other than `ruleId`. A withheld rule SHALL NOT be
executed, SHALL NOT be described as unsafe, unknown, or drifted, and SHALL NOT be offered
restore.

#### Scenario: Withheld is matched by rule id

- **WHEN** `entitlement.withheld` lists `{ ruleId: "no-env-leak-3fa9c21b", revisionId }` and the CLI reported that rule
- **THEN** the rule SHALL be classified as withheld for entitlement and SHALL NOT execute

#### Scenario: Entitled response withholds nothing

- **WHEN** a reconcile response carries `entitlement: { runtimeSignatures: true }`
- **THEN** no rule SHALL be classified as withheld

#### Scenario: Withheld is not offered restore

- **WHEN** a runtime rule is withheld for entitlement
- **THEN** no notice SHALL suggest restoring it

#### Scenario: A malformed upgrade URL is not shown

- **WHEN** `entitlement.upgradeUrl` is not an absolute `https:` URL
- **THEN** the CLI SHALL omit it from human and `--json` output

### Requirement: A copy of an issued rule does not run as a local rule

When reconcile returns an `unknown` rule carrying `copyOf` (taskless/taskless#255), the CLI
SHALL NOT run or execute it, and SHALL remove it from the snapshot the engines read. For an
`sg` or `vale` rule, `check` SHALL fail with one message naming the rule, the source rule
`copyOf.ruleId`, and each path in `copyOf.files` as changed, removed, or added. For a runtime
rule, the exit code SHALL NOT change, and its skip reason SHALL name the source and say it
was not issued by the rule service.

When `copyOf.ruleId` is also returned as `missing`, the CLI SHALL report the pair as one
rename: the copy's message SHALL say the source was deleted and SHALL name
`taskless rule restore <copyOf.ruleId>`, and the CLI SHALL NOT print a separate `missing`
warning for the source. A runtime rename SHALL be one notice and SHALL NOT change the exit
code. `copyOf` absent or `null` SHALL be treated as no copy. A `copyOf` that is present but
has no non-empty string `ruleId` SHALL fail closed: the rule SHALL be treated as
unaccounted.

#### Scenario: A renamed and loosened Vale rule fails check as one rename

- **WHEN** reconcile returns vale rule `bar-2` in `unknown` with `copyOf.ruleId` `foo-1` and `copyOf.files` listing `.vale.ini` changed, and returns `foo-1` as `missing`
- **THEN** `bar-2` SHALL NOT run
- **AND** `check` SHALL exit non-zero with one message saying `bar-2` is a copy of `foo-1`, which was deleted, naming `.vale.ini` as changed and `taskless rule restore foo-1`
- **AND** the CLI SHALL NOT print a separate warning that `foo-1` is missing

#### Scenario: A copy beside its present source fails check

- **WHEN** reconcile returns sg rule `bar-2` in `unknown` with `copyOf.ruleId` `foo-1`, and `foo-1` is not `missing`
- **THEN** `bar-2` SHALL NOT run
- **AND** `check` SHALL exit non-zero naming `bar-2` as a copy of `foo-1`

#### Scenario: A runtime copy is not executed and does not fail

- **WHEN** reconcile returns a runtime rule in `unknown` with `copyOf`
- **THEN** the rule SHALL NOT execute
- **AND** its skip reason SHALL name the source rule
- **AND** the exit code SHALL NOT change because of it

#### Scenario: An unreadable copyOf fails closed

- **WHEN** reconcile returns a rule in `unknown` whose `copyOf` is present but has no string `ruleId`
- **THEN** the rule SHALL NOT run or execute
- **AND** `check` SHALL exit non-zero naming it
