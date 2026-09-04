## MODIFIED Requirements

### Requirement: Test runs a rule's fixtures and runs verify first

`test` SHALL execute a rule against its test material — ast-grep test cases, Vale `pass`/`fail` fixture buckets, or the runtime harness — and SHALL run `verify` first, stopping on a verify failure without running the fixtures.

Ordering is the point. When a rule is both malformed and under-fixtured, the fixture complaint is the less useful of the two errors and is the one that surfaces first if the checks run in the other order — so the author is told their fixtures are incomplete while the reason the rule could never have run goes unmentioned.

A rule that populates only one bucket has proved only half of what a rule claims, whatever its engine. An engine SHALL NOT be trusted to report this itself: `ast-grep test` reports an empty `invalid:` bucket as `1 passed; 0 failed` and exits zero, so a rule that has never matched anything is indistinguishable from one that passed.

A runtime rule's fixtures execute code, so they SHALL run only when `--dangerously-run-scripts` is passed, and under no other mechanism. `test` SHALL NOT consult the rule service to decide this, and SHALL make no network request in the course of running fixtures.

That is deliberately stricter than the policy `check` applies, not softer. `check` executes rules as a side effect of scanning a repository, so a blessed signature admits code the user never asked to run and a reconcile stands between the request and the execution. `test` runs fixtures because the user asked for them, so the verb is the consent and the flag is the confirmation; a rule that `check` would run unflagged on a blessed signature still requires the flag here. Nothing executes under `test` that would not have executed under the shared policy.

A run refused for want of the flag SHALL be reported as not run, and SHALL be reported as neither a pass nor a failure: the rule is not defective, and no action available to its holder would make a failure green. The refusal SHALL name the flag, and SHALL NOT direct the reader to authenticate — authenticating cannot bless a rule that never left the working tree, so naming it would offer a fix that is not one.

#### Scenario: A malformed rule reports the malformation, not the fixtures

- **WHEN** `test` runs against a rule that is both invalid and missing a fixture bucket
- **THEN** it SHALL report the validation error
- **AND** it SHALL NOT report the fixture coverage as the failure

#### Scenario: Vale fixtures are tested per bucket

- **WHEN** `test` runs against a Vale rule
- **THEN** every `fail/` document SHALL produce at least one finding for that rule
- **AND** every `pass/` document SHALL produce none
- **AND** a rule populating only one bucket SHALL be reported as unverified rather than passing

#### Scenario: ast-grep fixtures are counted per bucket

- **WHEN** `test` runs against an ast-grep rule
- **THEN** the `valid:` and `invalid:` entries SHALL be counted across every `-test.yml` file the rule owns
- **AND** a rule populating only one bucket SHALL be reported as unverified rather than passing
- **AND** a rule whose buckets are all empty or absent SHALL be reported as unverified rather than passing
- **AND** a green `ast-grep test` run SHALL NOT on its own be sufficient to report the rule as passing

#### Scenario: Runtime fixtures are run per case

- **WHEN** `test` runs against a runtime rule with `--dangerously-run-scripts`
- **THEN** each directory under `.tests/fail/` SHALL be passed to the check as its `root` and SHALL produce at least one finding
- **AND** each directory under `.tests/pass/` SHALL be passed as its `root` and SHALL produce none
- **AND** a rule populating only one bucket SHALL be reported as unverified rather than passing
- **AND** a rule holding no fixture cases at all SHALL be reported as unverified rather than passing

#### Scenario: A runtime rule without the flag is reported as not run

- **WHEN** `test` runs against a runtime rule without `--dangerously-run-scripts`
- **THEN** the rule SHALL NOT be reported as passing
- **AND** the output SHALL say the fixtures did not run and why
- **AND** the output SHALL name `--dangerously-run-scripts` as what would run them
- **AND** the output SHALL NOT direct the reader to authenticate
- **AND** the rule SHALL NOT be counted among the rules tested
- **AND** the refusal alone SHALL NOT fail the command

#### Scenario: Testing a runtime rule reaches no network

- **WHEN** `test` runs against a runtime rule, with or without `--dangerously-run-scripts`
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
