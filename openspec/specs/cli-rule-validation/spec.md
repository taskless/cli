# cli-rule-validation Specification

## Purpose

TBD - created by archiving change self-contained-rules. Update Purpose after archive.

## Requirements

### Requirement: Rules are validated and tested by path, not by id

The CLI SHALL provide `verify <path>` and `test <path>`. Both SHALL accept a path to a rule's canonical location or to any directory above it, and SHALL resolve the owning engine from the path's position under `.taskless/rules/<engine>/` rather than by parsing the file.

An id does not name one thing. The same id can exist under `sg` and under `vale`, so an id-addressed command has to either guess or report an ambiguity; a path has neither problem. Resolving the engine from position — never from content — is the same rule dispatch follows, so a rule cannot be validated by one engine and executed by another.

#### Scenario: A rule path resolves to its engine

- **WHEN** `verify .taskless/rules/vale/no-simply` is run
- **THEN** the CLI SHALL validate it as a Vale rule

#### Scenario: The same id under two engines is not ambiguous

- **WHEN** `no-simply` exists under both `rules/sg/` and `rules/vale/`
- **THEN** each is addressed by its own path
- **AND** neither command SHALL require the user to disambiguate

#### Scenario: A directory means everything beneath it

- **WHEN** `verify .taskless/` is run
- **THEN** every rule beneath it SHALL be validated, each against its own engine
- **AND** the command SHALL report per-rule results rather than a single pass or fail

#### Scenario: A path outside any engine's rules directory is rejected

- **WHEN** a path resolves to no engine
- **THEN** the CLI SHALL exit non-zero naming the path, rather than guessing an engine

### Requirement: Verify checks a rule's required components

`verify` SHALL check that a rule has the components its engine requires and that they are well formed, and SHALL NOT require fixtures or test cases to exist.

The two commands split because they have different preconditions. An agent part-way through authoring has a rule and no fixtures yet, and needs to know the rule itself is valid before it can write a meaningful test for it.

Per engine, `verify` SHALL check:

| Engine    | Components                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `sg`      | `<id>.yml` against the ast-grep schema and the Taskless required fields                              |
| `vale`    | `<id>.yml` against the Vale rule schema and the Taskless required fields, and the rule's `.vale.ini` |
| `runtime` | `check.ts` present, and at least one capture rule under `captures/`                                  |

The `vale` row previously read "against Vale's own validation." Measured against the pinned 3.18.0 binary, that covers less than it claims: `level: bananas` is reported, while `extends: nonsense` and `scope: fenced` both verify clean and produce a rule that matches nothing. Vale validates a rule when it _runs_ one, and it runs one field at a time — so a name it does not recognize is not an error, it is a check that never fires. Schema validation is therefore its own layer for `vale`, as it already is for `sg`.

#### Scenario: A rule with no fixtures still verifies

- **WHEN** `verify` runs against a rule whose fixture buckets are empty or absent
- **THEN** it SHALL report on the rule's components only
- **AND** the absence of fixtures SHALL NOT be a verify failure

#### Scenario: A malformed rule reports its own error

- **WHEN** a Vale style declares a `level` outside `suggestion`/`warning`/`error`
- **THEN** `verify` SHALL report that error, naming the field

#### Scenario: An unrecognized extension point is rejected

- **WHEN** a Vale style declares an `extends` that is not one of Vale's check types
- **THEN** `verify` SHALL report it, naming the field and the accepted values
- **AND** it SHALL NOT report the rule as valid

#### Scenario: An unrecognized scope is rejected

- **WHEN** a Vale style declares a `scope` that is not one of Vale's scope values
- **THEN** `verify` SHALL report it, naming the field
- **AND** a scope using the `~` negation or `&` chaining syntax over recognized values SHALL be accepted

#### Scenario: A field belonging to another check type is rejected

- **WHEN** a Vale style declares a field its `extends` does not accept, such as `tokens` on an `occurrence` check
- **THEN** `verify` SHALL report it before Vale is invoked

The failure it prevents is not a local one: Vale reports this as `E201: has invalid keys` and reads one assembled config per run, so a single rule with a stray field suppresses every other Vale rule's findings.

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

### Requirement: The generation loop runs verify and test

The rule generation loop SHALL run `verify` and then `test` against a newly authored or newly delivered rule, and SHALL treat a failure of either as a rule that is not ready to report as complete.

#### Scenario: A generated rule is checked before it is reported

- **WHEN** a rule is authored locally or written by the service
- **THEN** the loop SHALL run `verify` and `test` against its path
- **AND** SHALL surface a failure rather than reporting the rule as written

### Requirement: The Vale rule schema is pinned to the vendored binary

The Vale rule schema's vocabulary SHALL be derived from the vendored binary by a generator in this repository, written to a checked-in artifact pinned to `VALE_VERSION`, and a differential test SHALL hold the schema's claims against that binary.

Vale publishes no JSON Schema for its check types. The machine-readable field knowledge exists only behind its hosted MCP server, which is a paid product and unavailable to `verify`. The binary, not the documentation, SHALL therefore be the authority for what the schema asserts — and it SHALL be asked by a script that can be re-run, rather than by hand once. What a transcription loses is not the answer but the question: a later reader inherits a value with no way to reproduce the measurement that produced it.

The generator SHALL take every verdict from the process exit status and the structured JSON output, and SHALL NOT take one by matching output against an error phrase. A configuration error is reported on stderr as an object carrying a `Code`; a crash produces no such object at all. A probe that matches on a phrase scores a crash as a clean run, which has already produced a wrong entry in this schema.

Where the derivation rests on a proposed candidate rather than on a set the binary enumerates, that SHALL be recorded as a limit of the artifact. Vale names the key an author got wrong and never the ones they could have used, and an unrecognized scope raises nothing at all — so field tables and scope operands are verified rather than discovered, and a value nobody proposes is absent.

#### Scenario: A Vale upgrade that invalidates the schema fails loudly

- **WHEN** `VALE_VERSION` is raised to a version whose accepted check types, fields, or scopes differ from the artifact
- **THEN** the differential test SHALL fail
- **AND** the failure SHALL name the construct whose treatment changed

#### Scenario: The generator refuses to emit a vocabulary it cannot read

- **WHEN** the binary's enumeration of its own accepted values no longer matches the shape the generator parses
- **THEN** the generator SHALL fail with an error naming what it could not read
- **AND** it SHALL NOT emit a partial enumeration

A short enum is _stricter_ than the binary, so a silent partial parse would begin rejecting rules Vale accepts — blocking work that would have functioned, which is the worse of the two failure directions.

#### Scenario: A divergence from Vale's documentation is reported, not dropped

- **WHEN** the binary's measured behavior disagrees with Vale's published documentation, in either direction
- **THEN** generation SHALL emit that disagreement as part of its output
- **AND** the artifact SHALL record which side the schema followed

A documented value that never fires is a trap an author walks into with the docs open. An undocumented value that works is evidence that something real may be missing from the candidate list. Neither may be resolved silently.

#### Scenario: The vocabulary describes the binary the build ships

- **WHEN** the checked-in artifact records a different Vale version than `VALE_VERSION`
- **THEN** the build SHALL fail
- **AND** the failure SHALL name the two versions

#### Scenario: Behavior a schema cannot express stays explicit

- **WHEN** a rule shape crashes the binary although every key in it is a legal field of its check
- **THEN** the schema SHALL reject that shape through a check stated alongside the generated field tables
- **AND** the rejection SHALL NOT be encoded as a field-table fact

### Requirement: A rejection names the constraint it violated

`verify --json` and `test --json` SHALL report, per rule, the constraints a
rejection violated, pairing a `constraintId` drawn from the published
`RULE_CONSTRAINTS` with the message that reports it.

The existing `errors` array SHALL continue to carry every failure message,
including those that are attributable. A consumer reading only `errors` SHALL
see what it sees today, so this is additive.

An error with no constraint behind it SHALL NOT be given one. A wrong
attribution sends a reader to a rationale that does not describe their failure,
which is worse than sending them to none.

A consumer SHALL NOT have to match on message text to recover the constraint.
Text matching rots the first time a message is rephrased, and rephrasing an
error message is not a breaking change.

#### Scenario: A mismatched rule id is attributed

- **WHEN** `verify --json` refuses a rule whose `id:` does not match its directory
- **THEN** the rule's result SHALL carry a violation with `constraintId` `sg-id-matches-directory`
- **AND** the violation's message SHALL also appear in `errors`

#### Scenario: An unattributable failure carries no id

- **WHEN** `verify --json` reports a failure that no published constraint describes
- **THEN** the message SHALL appear in `errors`
- **AND** no violation SHALL be reported for it

#### Scenario: A passing rule reports no violations

- **WHEN** `verify --json` accepts a rule
- **THEN** its violations SHALL be empty
