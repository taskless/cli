## MODIFIED Requirements

### Requirement: Check subcommand exit codes reflect error severity

The CLI SHALL exit with code 0 when no error-severity matches are found (including when only warnings, info, or hints exist) and no reconcile outcome below requires failure. The CLI SHALL exit with code 1 when at least one error-severity match is found. The CLI SHALL also exit with code 1, whatever the findings and in both human and `--json` modes, when a completed reconcile:

- returned a non-empty `entitlement.withheld`;
- returned an `unsafe` verdict for an `sg` or `vale` rule;
- returned an `sg` or `vale` rule in `unknown` carrying `copyOf`, or a rule of any engine carrying a `copyOf` the CLI cannot read; or
- left a reported rule unaccounted for (in none, or more than one, of `rules`, `unknown`, and `entitlement.withheld`).

On an authenticated run that would reconcile, the CLI SHALL also exit with code 1 when two rule directories under different engines share an id. A logged-out run verifies nothing and does not fail on it. Under `--json`, `success` SHALL be `false` whenever the exit code is non-zero.

#### Scenario: Exit 0 when clean

- **WHEN** the scanner produces zero results
- **THEN** the process SHALL exit with code 0

#### Scenario: Exit 0 when only warnings

- **WHEN** the scanner produces results but none have severity "error"
- **THEN** the process SHALL exit with code 0

#### Scenario: Exit 1 when errors found

- **WHEN** the scanner produces at least one result with severity "error"
- **THEN** the process SHALL exit with code 1

#### Scenario: Exit 1 when a runtime rule is withheld for entitlement

- **WHEN** reconciliation returns a non-empty `entitlement.withheld` and the scan produces zero results
- **THEN** the process SHALL exit with code 1
- **AND** under `--json`, `success` SHALL be `false`

#### Scenario: Entitlement without a withheld file does not fail

- **WHEN** reconciliation returns `entitlement.runtimeSignatures: false` with an empty or absent `withheld`, and the scan produces zero results
- **THEN** the process SHALL exit with code 0

#### Scenario: Exit 1 when a static rule was edited

- **WHEN** reconciliation returns an `unsafe` verdict for an `sg` or `vale` rule and the scan produces zero results
- **THEN** the process SHALL exit with code 1

#### Scenario: Exit 1 when a static rule is a copy of an issued rule

- **WHEN** reconciliation returns an `sg` or `vale` rule in `unknown` with `copyOf`, and the scan produces zero results
- **THEN** the process SHALL exit with code 1

#### Scenario: Exit 1 when a reported rule is unaccounted for

- **WHEN** a reported rule appears in none of `rules`, `unknown`, and `entitlement.withheld`
- **THEN** the process SHALL exit with code 1

#### Scenario: Missing does not fail

- **WHEN** reconciliation returns only `run` and `missing` verdicts and the scan produces zero results
- **THEN** the process SHALL exit with code 0

### Requirement: Check reports rule integrity under --json

Under `--json`, `taskless check` SHALL carry an additive, optional `integrity` array with one
entry per rule whose outcome is `unsafe`, `missing`, runtime `unknown`, `unknown` with
`copyOf` (any engine), `unaccounted`, or `duplicate`, each
`{ ruleId, engine?, verdict, files?, revisionId?, copyOf? }`. `files` SHALL list each
differing path with `expected` and `got` as the server returned them; for a copy it SHALL be
the server's `copyOf.files`. `copyOf` SHALL be `{ ruleId, revisionId?, sourceMissing }`, where
`sourceMissing` is whether the source rule was answered `missing`. Static `unknown` rules
without `copyOf` and `run` rules SHALL NOT appear. The field SHALL be omitted when there is
nothing to report.

#### Scenario: An edited rule appears with its differing files

- **WHEN** reconciliation returns `unsafe` for vale rule `no-simply-1a2b3c4d` with `.vale.ini` changed
- **THEN** `integrity` SHALL include `{ ruleId: "no-simply-1a2b3c4d", engine: "vale", verdict: "unsafe", files: [{ path: ".vale.ini", expected, got }] }`

#### Scenario: A clean run omits the field

- **WHEN** every reported rule is `run` or static `unknown` and nothing is `missing`
- **THEN** `check --json` SHALL NOT include `integrity`

#### Scenario: A renamed rule appears as a copy beside its missing source

- **WHEN** reconciliation returns vale rule `bar-2` in `unknown` with `copyOf: { ruleId: "foo-1", revisionId: "r1", files: [{ path: ".vale.ini", expected, got }] }` and returns `foo-1` as `missing` with `revisionId` `r2`
- **THEN** `integrity` SHALL include `{ ruleId: "bar-2", engine: "vale", verdict: "unknown", files: [{ path: ".vale.ini", expected, got }], copyOf: { ruleId: "foo-1", revisionId: "r1", sourceMissing: true } }`
- **AND** SHALL include `{ ruleId: "foo-1", engine: "vale", verdict: "missing", revisionId: "r2" }`
