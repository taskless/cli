## MODIFIED Requirements

### Requirement: Test runs a rule's fixtures and runs verify first

`test` SHALL execute a rule against its test material — ast-grep test cases, Vale `pass`/`fail` fixture buckets, or the runtime harness — and SHALL run `verify` first, stopping on a verify failure without running the fixtures.

Ordering is the point. When a rule is both malformed and under-fixtured, the fixture complaint is the less useful of the two errors and is the one that surfaces first if the checks run in the other order — so the author is told their fixtures are incomplete while the reason the rule could never have run goes unmentioned.

A rule that populates only one bucket has proved only half of what a rule claims, whatever its engine. An engine SHALL NOT be trusted to report this itself: `ast-grep test` reports an empty `invalid:` bucket as `1 passed; 0 failed` and exits zero, so a rule that has never matched anything is indistinguishable from one that passed.

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
