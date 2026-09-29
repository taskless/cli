## MODIFIED Requirements

### Requirement: Check subcommand exit codes reflect error severity

The CLI SHALL exit with code 0 when no error-severity matches are found (including when only warnings, info, or hints exist) and no reconcile outcome below requires failure. The CLI SHALL exit with code 1 when at least one error-severity match is found. The CLI SHALL also exit with code 1, whatever the findings and in both human and `--json` modes, when a completed reconcile:

- returned a non-empty `entitlement.withheld`;
- returned an `unsafe` verdict for an `sg` or `vale` rule; or
- left a reported rule unaccounted for (in none, or more than one, of `rules`, `unknown`, and `entitlement.withheld`).

The CLI SHALL also exit with code 1 when two rule directories under different engines share an id. Under `--json`, `success` SHALL be `false` whenever the exit code is non-zero.

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

#### Scenario: Exit 1 when a reported rule is unaccounted for

- **WHEN** a reported rule appears in none of `rules`, `unknown`, and `entitlement.withheld`
- **THEN** the process SHALL exit with code 1

#### Scenario: Missing does not fail

- **WHEN** reconciliation returns only `run` and `missing` verdicts and the scan produces zero results
- **THEN** the process SHALL exit with code 0

### Requirement: Check selects what it runs from auth state

`taskless check` SHALL NOT require authentication, and it SHALL choose what it verifies from
the current auth state. When a token is available and `--anonymous` is not set, the CLI SHALL
reconcile **every** rule (ast-grep, Vale, and runtime) and apply the verdict policy of the
`cli-rule-reconciliation` capability. When no token is available, when `--anonymous` is set, or
when reconciliation cannot complete, the CLI SHALL run every static rule (ast-grep and Vale)
unverified and SHALL skip runtime execution unless `--dangerously-run-scripts` is set. The
unauthenticated path SHALL succeed with no network access and SHALL NOT emit a warning about
missing authentication.

#### Scenario: Unauthenticated check runs static rules and skips runtime rules

- **WHEN** a user runs `taskless check` with no available token
- **THEN** the CLI SHALL scan all static rules
- **AND** SHALL NOT call `POST /cli/api/v2/reconcile`
- **AND** SHALL skip runtime rules
- **AND** SHALL NOT emit a warning about missing authentication

#### Scenario: Authenticated check reconciles runtime rules

- **WHEN** a user runs `taskless check` with an available token and without `--anonymous`
- **THEN** the CLI SHALL reconcile its ast-grep, Vale, and runtime rules in one request
- **AND** SHALL run or execute each rule according to its verdict

#### Scenario: Anonymous forces the logged-out path

- **WHEN** a user runs `taskless check --anonymous` while a token is available
- **THEN** the CLI SHALL behave exactly as an unauthenticated `check` (static rules run, runtime rules skipped, no reconcile call)

#### Scenario: Logged out, an edited static rule still runs

- **WHEN** a user runs `taskless check` with no available token and an issued sg or vale rule has been edited
- **THEN** the edited rule SHALL run with no signature enforcement
- **AND** runtime rules SHALL be skipped
- **AND** the exit code SHALL NOT change because the rule was edited

#### Scenario: Logged in, an edited rule of any engine does not run

- **WHEN** an authenticated `check` reconciles and a rule of any engine is `unsafe`
- **THEN** that rule SHALL NOT run or execute

### Requirement: Check reconciles rule files before scanning

`taskless check` SHALL reconcile before running any rule whenever a bearer token and a
`repositoryUrl` are resolvable and `--anonymous` is not set. It SHALL snapshot the rules tree,
report every rule directory from the snapshot to `POST /cli/api/v2/reconcile` (per the
`cli-rule-reconciliation` capability), remove from the snapshot every rule its verdict
excludes, and only then assemble engine configs and run.

#### Scenario: Only rules with a blessed check.ts execute

- **WHEN** a user runs `taskless check` while authenticated and reconciliation returns `run` for some rules, `unsafe` for a static rule, and `unknown` for a runtime rule
- **THEN** the CLI SHALL run the `run` rules
- **AND** SHALL NOT run the `unsafe` static rule
- **AND** SHALL NOT execute the `unknown` runtime rule

### Requirement: Check degrades to a local scan when reconciliation cannot complete

`taskless check` SHALL NOT fail solely because an attempted reconciliation cannot complete.
When a token is available and `--anonymous` is not set but reconciliation cannot complete (no
resolvable git remote, the endpoint unreachable, a `401`, a `404 organization_not_found`, or a
transport error), the CLI SHALL warn that rule verification could not be performed, SHALL run
every **static** rule from the snapshot unverified, and SHALL **skip runtime rules** unless
`--dangerously-run-scripts` is set. The CLI SHALL NOT exit with a non-zero code solely because
reconciliation failed, and the warning SHALL be suppressed under `--json`.

#### Scenario: Endpoint unreachable degrades static and skips runtime

- **WHEN** an authenticated `check` attempts reconciliation and the endpoint is unreachable or returns an error
- **THEN** the CLI SHALL warn that verification could not be performed
- **AND** SHALL scan all static rules
- **AND** SHALL NOT execute any runtime rule's `check.ts`
- **AND** SHALL NOT exit with a non-zero code solely due to the reconcile failure

#### Scenario: Degrade warning is suppressed under --json

- **WHEN** the CLI degrades and `--json` is set
- **THEN** stdout SHALL contain the machine JSON shape (`{ success, results }` plus the additive optional `skipped` array for the skipped runtime rules)
- **AND** SHALL NOT contain the human-readable degrade warning

### Requirement: Check runs runtime rules only on a signature-validated path

`taskless check` SHALL execute a runtime rule's `check.ts` only when reconciliation returned a
`run` verdict for that rule, or when `--dangerously-run-scripts` is set. An API key SHALL be
treated identically to an interactive token. On any path where the rule was not validated —
logged out, `--anonymous`, a reconciliation that cannot complete, or a verdict other than
`run` — the CLI SHALL NOT execute the rule's `check.ts`.

#### Scenario: Authenticated check runs blessed runtime rules

- **WHEN** an authenticated `check` reconciles and a runtime rule's verdict is `run`
- **THEN** the CLI SHALL execute that runtime rule through the harness

#### Scenario: A rule whose check.ts is not blessed is withheld

- **WHEN** reconciliation returns `unsafe` for a runtime rule, lists it in `unknown`, or withholds it for entitlement
- **THEN** the CLI SHALL NOT execute that runtime rule
- **AND** SHALL report it as skipped with a reason naming the verdict

#### Scenario: API key behaves like a token

- **WHEN** `check` runs with an API key
- **THEN** the CLI SHALL reconcile and run validated runtime rules exactly as with an interactive token

### Requirement: Check reports runtime rules withheld for entitlement as a plan outcome

When reconciliation completes and returns a non-empty `entitlement.withheld`, `taskless check` SHALL NOT execute any withheld rule, SHALL report each local runtime rule whose `ruleId` appears in `withheld` as skipped with a reason stating that runtime rules are not included in the organization's plan, and SHALL NOT describe it as unsafe, unknown, drifted, or tampered. The human output SHALL include one notice naming the withheld rules, the `entitlement.reason`, and the `entitlement.upgradeUrl` when present. Under `--json`, the output SHALL carry an additive, optional `entitlement` object with `runtimeSignatures`, `reason`, `upgradeUrl`, and `withheld` (the local rule names), present only when reconciliation returned `runtimeSignatures: false`. This is a verified outcome and SHALL NOT be treated as one of the unverified paths that leave the exit code unchanged.

#### Scenario: Withheld rule is named with its cause

- **WHEN** an authenticated `check` reconciles and `entitlement.withheld` lists runtime rule `no-env-leak-3fa9c21b`
- **THEN** `no-env-leak-3fa9c21b` SHALL NOT execute
- **AND** its skip reason SHALL state that runtime rules are not included in the plan
- **AND** its skip reason SHALL NOT mention unsafe, unknown, or drift

#### Scenario: Upgrade URL is shown once

- **WHEN** two runtime rules are withheld and `entitlement.upgradeUrl` is present
- **THEN** the human output SHALL print the upgrade URL exactly once, in one notice naming both rules and the reason

#### Scenario: Entitlement appears under --json

- **WHEN** a runtime rule is withheld and `--json` is set
- **THEN** stdout SHALL include `entitlement` with `runtimeSignatures: false`, `reason`, `upgradeUrl`, and `withheld` naming the rule
- **AND** `skipped` SHALL still list the rule with its plan reason

#### Scenario: A server without the entitlement object is unchanged

- **WHEN** reconciliation returns `entitlement: { runtimeSignatures: true }`, or (against its schema) no `entitlement` object at all
- **THEN** `check --json` SHALL omit the `entitlement` field
- **AND** no rule SHALL be skipped for its plan

#### Scenario: Degrade paths still never fail

- **WHEN** `check` runs logged out, with `--anonymous`, or reconciliation cannot complete
- **THEN** the exit code SHALL NOT change because runtime rules were skipped, as before this change

### Requirement: Check accepts --anonymous as a no-op

The `taskless check` command SHALL accept the global `--anonymous` flag (per the `cli`
capability). Because `check` reconciles against the Taskless API when authenticated,
`--anonymous` SHALL force the logged-out path: it SHALL suppress the reconcile network call
and run all local static rules. Aside from forcing the logged-out path, `--anonymous` SHALL NOT
change scan behavior, output shape, or exit codes relative to an unauthenticated `check`.

#### Scenario: check --anonymous skips reconciliation

- **WHEN** a user runs `taskless check --anonymous`
- **THEN** the CLI SHALL NOT call `POST /cli/api/v2/reconcile`
- **AND** SHALL scan all local static rules

#### Scenario: check --anonymous matches an unauthenticated check

- **WHEN** a user runs `taskless check --anonymous`
- **THEN** its scan behavior, output, and exit code SHALL match `taskless check` run with no
  available token

### Requirement: Check accepts --dangerously-run-scripts to run runtime rules without server validation

`taskless check` SHALL accept a `--dangerously-run-scripts` flag that runs **all** rules without
server validation, regardless of auth state.
When the flag is set the CLI SHALL NOT reconcile — it SHALL skip the network entirely (matching
how `--anonymous` forces the no-network path), SHALL compute and enforce no signatures for any
engine, run every present static rule, and execute every present runtime rule. The CLI SHALL
emit a prominent warning that runtime rule code is being executed unverified. The flag SHALL be
the only way to execute runtime rules on an unverified path.

#### Scenario: Dangerously-run-scripts executes runtime rules offline

- **WHEN** a user runs `taskless check --dangerously-run-scripts` with no available token
- **THEN** the CLI SHALL execute the present runtime rules' `check.ts`
- **AND** SHALL emit a warning that runtime rule code ran unverified

#### Scenario: Warning is suppressed under --json

- **WHEN** `--dangerously-run-scripts` and `--json` are both set
- **THEN** stdout SHALL contain only the existing `{ success, results }` JSON shape
- **AND** the unverified-execution warning SHALL NOT appear in stdout

#### Scenario: No signature is enforced while logged in

- **WHEN** an authenticated user runs `taskless check --dangerously-run-scripts` and an issued vale rule has been edited
- **THEN** the CLI SHALL NOT call reconcile
- **AND** the edited rule SHALL run
- **AND** the exit code SHALL NOT change because the rule was edited

## ADDED Requirements

### Requirement: Check never writes to the rules tree

`taskless check` SHALL NOT create, modify, or delete anything under `.taskless/rules/`. It
SHALL NOT call restore, rollback, or rule fetch. For an `unsafe` or `missing` verdict it SHALL
name the command that repairs the rule, `taskless rule restore <ruleId>`. The only files
`check` writes under `.taskless/` SHALL be under `.taskless/.run/`.

#### Scenario: An edited rule is reported, not repaired

- **WHEN** reconciliation returns `unsafe` for a rule
- **THEN** `.taskless/rules/` SHALL be byte-identical before and after the run
- **AND** the output SHALL name `taskless rule restore <ruleId>`

#### Scenario: A missing rule is not fetched

- **WHEN** reconciliation returns `missing` for a rule
- **THEN** `check` SHALL NOT call any restore or fetch endpoint
- **AND** SHALL NOT create the rule's directory

### Requirement: Check reports rule integrity under --json

Under `--json`, `taskless check` SHALL carry an additive, optional `integrity` array with one
entry per rule whose outcome is `unsafe`, `missing`, runtime `unknown`, `unaccounted`, or
`duplicate`, each `{ ruleId, engine?, verdict, files?, revisionId? }`. `files` SHALL list each
differing path with `expected` and `got` as the server returned them. Static `unknown` rules
and `run` rules SHALL NOT appear. The field SHALL be omitted when there is nothing to report.

#### Scenario: An edited rule appears with its differing files

- **WHEN** reconciliation returns `unsafe` for vale rule `no-simply-1a2b3c4d` with `.vale.ini` changed
- **THEN** `integrity` SHALL include `{ ruleId: "no-simply-1a2b3c4d", engine: "vale", verdict: "unsafe", files: [{ path: ".vale.ini", expected, got }] }`

#### Scenario: A clean run omits the field

- **WHEN** every reported rule is `run` or static `unknown` and nothing is `missing`
- **THEN** `check --json` SHALL NOT include `integrity`
