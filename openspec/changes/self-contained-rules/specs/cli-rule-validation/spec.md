## ADDED Requirements

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

| Engine    | Components                                                                     |
|-----------|--------------------------------------------------------------------------------|
| `sg`      | `<id>.yml` against the ast-grep schema and the Taskless required fields        |
| `vale`    | `<id>.yml` against Vale's own validation, and the rule's `.vale.ini`           |
| `runtime` | `check.ts` present, and at least one capture rule under `captures/`            |

#### Scenario: A rule with no fixtures still verifies

- **WHEN** `verify` runs against a rule whose fixture buckets are empty or absent
- **THEN** it SHALL report on the rule's components only
- **AND** the absence of fixtures SHALL NOT be a verify failure

#### Scenario: A malformed rule reports its own error

- **WHEN** a Vale style declares a `level` outside `suggestion`/`warning`/`error`
- **THEN** `verify` SHALL report that error, naming the field

### Requirement: Test runs a rule's fixtures and runs verify first

`test` SHALL execute a rule against its test material — ast-grep test cases, Vale `pass`/`fail` fixture buckets, or the runtime harness — and SHALL run `verify` first, stopping on a verify failure without running the fixtures.

Ordering is the point. When a rule is both malformed and under-fixtured, the fixture complaint is the less useful of the two errors and is the one that surfaces first if the checks run in the other order — so the author is told their fixtures are incomplete while the reason the rule could never have run goes unmentioned.

#### Scenario: A malformed rule reports the malformation, not the fixtures

- **WHEN** `test` runs against a rule that is both invalid and missing a fixture bucket
- **THEN** it SHALL report the validation error
- **AND** it SHALL NOT report the fixture coverage as the failure

#### Scenario: Vale fixtures are tested per bucket

- **WHEN** `test` runs against a Vale rule
- **THEN** every `fail/` document SHALL produce at least one finding for that rule
- **AND** every `pass/` document SHALL produce none
- **AND** a rule populating only one bucket SHALL be reported as unverified rather than passing

### Requirement: The generation loop runs verify and test

The rule generation loop SHALL run `verify` and then `test` against a newly authored or newly delivered rule, and SHALL treat a failure of either as a rule that is not ready to report as complete.

#### Scenario: A generated rule is checked before it is reported

- **WHEN** a rule is authored locally or written by the service
- **THEN** the loop SHALL run `verify` and `test` against its path
- **AND** SHALL surface a failure rather than reporting the rule as written
