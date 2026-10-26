## MODIFIED Requirements

### Requirement: Verify runs a rule's fixtures and runs validate first

`verify` SHALL execute a rule against its fixture cases, laid out and judged as `cli-rule-fixtures` describes for every engine, and SHALL run `validate` first, stopping on a validate failure without running the fixtures.

Ordering is the point. When a rule is both malformed and under-fixtured, the fixture complaint is the less useful of the two errors and is the one that surfaces first if the checks run in the other order — so the author is told their fixtures are incomplete while the reason the rule could never have run goes unmentioned.

A rule that populates only one bucket has proved only half of what a rule claims, whatever its engine. An engine SHALL NOT be trusted to report this itself: `ast-grep test` reported an empty `invalid:` bucket as `1 passed; 0 failed` and exited zero, so a rule that had never matched anything was indistinguishable from one that passed. Coverage is therefore counted by the CLI over case directories, never read from an engine's summary.

A runtime rule's fixtures execute code, so they SHALL run only when `--dangerously-run-scripts` is passed, and under no other mechanism. `verify` SHALL NOT consult the rule service to decide this, and SHALL make no network request in the course of running fixtures.

That is deliberately stricter than the policy `check` applies, not softer. `check` executes rules as a side effect of scanning a repository, so a blessed signature admits code the user never asked to run and a reconcile stands between the request and the execution. `verify` runs fixtures because the user asked for them, so the verb is the consent and the flag is the confirmation; a rule that `check` would run unflagged on a blessed signature still requires the flag here. Nothing executes under `verify` that would not have executed under the shared policy.

A run refused for want of the flag SHALL be reported as not run, and SHALL be reported as neither a pass nor a failure: the rule is not defective, and no action available to its holder would make a failure green. The refusal SHALL name the flag, and SHALL NOT direct the reader to authenticate — authenticating cannot bless a rule that never left the working tree, so naming it would offer a fix that is not one.

`verify` SHALL report, per rule, the findings its fixtures produced, as a `findings` array carrying the same finding shape `check --json` prints — `source`, `ruleId`, `severity`, `message`, `file`, `range`, `matchedText` and the optional `note` and `fix` — plus the `bucket` the fixture that produced it belongs to.

The RENDERED message is the point, and it is what a verdict cannot carry. A rule whose message interpolates its captures can have its slots in the wrong order and still fire on every `fail/` fixture and stay quiet on every `pass/` one, so a boolean verdict reports it as a rule that passed. The only evidence that the message says what its author meant is the message as the engine rendered it, against material the author wrote, which `verify` already has in hand and discards.

The array SHALL be present on every rule result and SHALL be empty rather than absent when there is nothing to report — including for an engine that does not yet surface its fixture findings, a rule whose validation failed before fixtures ran, and a run the execution policy refused. A consumer SHALL NOT have to distinguish "this rule produced no findings" from "this command does not report findings", because a key that is sometimes absent is one a reader learns to treat as optional, and the reading that follows is that its absence means zero.

Fail-bucket findings SHALL be reported under `--json` on a passing run. They are the evidence, and a payload that carries the evidence only once the rule is already failing carries it at the one moment it is no longer needed.

The human rendering SHALL stay a single line per passing rule. Under a FAILING rule it SHALL print the findings that bear on the failure, labelled by bucket, using the same renderer `check` prints findings with, so one finding does not read two ways depending on which command surfaced it. A pass-bucket finding SHALL be printed there: it is a fixture that wrongly fired, and naming the file says only that it happened, while the finding says what matched.

#### Scenario: A malformed rule reports the malformation, not the fixtures

- **WHEN** `verify` runs against a rule that is both invalid and missing a fixture bucket
- **THEN** it SHALL report the validation error
- **AND** it SHALL NOT report the fixture coverage as the failure

#### Scenario: Another rule's config error does not fail this rule's fixtures

- **WHEN** `verify` runs against one `sg` rule while a different `sg` rule in the project is one ast-grep refuses
- **THEN** the rule under verification SHALL be judged on its own fixtures alone
- **AND** its result SHALL NOT carry the other rule's error

#### Scenario: Vale fixtures are tested per bucket

- **WHEN** `verify` runs against a Vale rule
- **THEN** every case directory under `tests/fail/` SHALL produce at least one finding for that rule
- **AND** every case directory under `tests/pass/` SHALL produce none
- **AND** a rule populating only one bucket SHALL be reported as unverified rather than passing

#### Scenario: ast-grep fixtures are counted per bucket

- **WHEN** `verify` runs against an ast-grep rule
- **THEN** every case directory under `tests/fail/` SHALL produce at least one finding for that rule
- **AND** every case directory under `tests/pass/` SHALL produce none
- **AND** a rule populating only one bucket SHALL be reported as unverified rather than passing
- **AND** a rule whose buckets are all empty or absent SHALL be reported as unverified rather than passing

#### Scenario: Runtime fixtures are run per case

- **WHEN** `verify` runs against a runtime rule with `--dangerously-run-scripts`
- **THEN** each directory under `tests/fail/` SHALL be passed to the check as its `root` and SHALL produce at least one finding
- **AND** each directory under `tests/pass/` SHALL be passed as its `root` and SHALL produce none
- **AND** a rule populating only one bucket SHALL be reported as unverified rather than passing
- **AND** a rule holding no fixture cases at all SHALL be reported as unverified rather than passing

#### Scenario: A runtime rule without the flag is reported as not run

- **WHEN** `verify` runs against a runtime rule without `--dangerously-run-scripts`
- **THEN** the rule SHALL NOT be reported as passing
- **AND** the output SHALL say the fixtures did not run and why
- **AND** the output SHALL name `--dangerously-run-scripts` as what would run them
- **AND** the output SHALL NOT direct the reader to authenticate
- **AND** the rule SHALL NOT be counted among the rules verified
- **AND** the refusal alone SHALL NOT fail the command

#### Scenario: Verifying a runtime rule reaches no network

- **WHEN** `verify` runs against a runtime rule, with or without `--dangerously-run-scripts`
- **THEN** the CLI SHALL NOT request a token, resolve an organization, or reconcile
- **AND** the outcome SHALL NOT depend on authentication state, a git remote, or the availability of the rule service

#### Scenario: A case that never reaches the check is reported as a fixture defect

- **WHEN** a fixture case produces no narrow matches, so the check is never invoked
- **THEN** the CLI SHALL report that case as a fixture defect naming the case
- **AND** SHALL say the check did not run
- **AND** SHALL do so whether the case is in `pass/` or `fail/`, since a case that never invokes the check is evidence about the fixture rather than about the rule

#### Scenario: A check that throws is distinguished from one that finds nothing

- **WHEN** a runtime rule's check raises while running a fixture case
- **THEN** that SHALL be reported as the check failing, not as the case producing no findings

#### Scenario: Verify reports the findings its fixtures produced

- **WHEN** `verify --json` runs against a rule whose fixtures produced findings
- **THEN** each rule result SHALL carry a `findings` array
- **AND** each entry SHALL carry the rendered `message`, `file`, `range`, `matchedText` and `severity` that `check --json` reports for the same finding
- **AND** each entry SHALL name the bucket of the fixture that produced it
- **AND** the fail-bucket findings SHALL be reported even when the rule passed

#### Scenario: The findings array is present and empty rather than absent

- **WHEN** `verify --json` reports a rule that produced no findings, whose validation failed before its fixtures ran, whose run was refused, or whose engine does not surface fixture findings
- **THEN** the rule result SHALL still carry a `findings` array
- **AND** that array SHALL be empty

#### Scenario: A failing rule prints the findings that bear on the failure

- **WHEN** `verify` runs without `--json` and a rule fails because a `pass/` fixture fired
- **THEN** the offending findings SHALL be printed under that rule, labelled by bucket
- **AND** they SHALL be rendered the way `check` renders a finding
- **AND** a rule that passed SHALL still print one line

## REMOVED Requirements

### Requirement: Verify reports the findings an ast-grep rule's fixtures produced

**Reason**: This requirement existed because ast-grep fixtures were snippets inside a test YAML, judged by `sg test`, which cannot emit a finding. Their findings had to come from a second scan over stdin, mapped back to positions inside block scalars. Under `cli-rule-fixtures`, an ast-grep case is a directory of real files judged by the same scan `check` runs, so the finding that decides the verdict is the reported finding. It carries ast-grep's rendered message, and its `file` and position already point at the fixture. The general findings guarantees (the same shape as `check --json`, the bucket, fail-bucket findings on a passing run, an array that is empty rather than absent) stay in "Verify runs a rule's fixtures and runs validate first". The isolation and no-residue guarantees move to `cli-rule-fixtures`.

**Migration**: Migration 12 converts every `valid:`/`invalid:` snippet into a case file. Consumers of `verify --json` see the same finding shape. `file` now names `tests/<bucket>/<case>/<file>` instead of the test YAML.
