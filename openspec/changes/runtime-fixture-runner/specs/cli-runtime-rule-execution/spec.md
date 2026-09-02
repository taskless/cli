## ADDED Requirements

### Requirement: A runtime rule's fixtures are executed through the harness

The CLI SHALL execute a runtime rule against the fixture cases it holds under
`.tests/pass/` and `.tests/fail/`. A case SHALL be a **directory**, and that
directory SHALL be the `root` the harness passes to the check.

Each bucket SHALL be read one level deep. An entry that is not a directory SHALL
be an error naming the path, not an ignored entry. Buckets SHALL be read
independently, and a bucket that cannot be read SHALL be an error rather than an
empty bucket.

**Rationale.** A check is a function over a root and its matches, reading
whatever files under that root it needs, so a case has to be a directory: a
runtime rule exists because its evidence spans more than one file, and a
one-file-per-case layout could not express the rules the tier is for. The
strictness on reading is the Vale runner's, for its reason — a swallowed
permission error on one bucket makes a two-sided rule look one-sided, and a
one-sided rule look complete.

#### Scenario: A case directory is the harness root

- **WHEN** a runtime rule's fixture case is executed
- **THEN** the check SHALL receive that case's directory as its `root`
- **AND** SHALL resolve the files it reads beneath that root

#### Scenario: A loose file in a bucket is refused

- **WHEN** a fixture bucket contains an entry that is not a directory
- **THEN** the CLI SHALL report an error naming that path
- **AND** SHALL NOT silently skip it

#### Scenario: An unreadable bucket is not an empty bucket

- **WHEN** a fixture bucket exists but cannot be read
- **THEN** the CLI SHALL report the failure
- **AND** SHALL NOT treat the bucket as holding no cases

### Requirement: Fixture execution obeys the runtime execution gate

Executing a fixture case SHALL be permitted only where executing the rule itself
would be: when an authenticated reconcile returns the rule's signature in `run`,
or when `--dangerously-run-scripts` is passed. No rule identifier SHALL be
exempt, and the fixture path SHALL NOT constitute a separate or softer gate.

**Rationale.** A fixture run executes the same `check.ts`, from the same
delivery, under the same signature as a scan. That the input is test data is a
statement about the input, not about what the program may do. A softer gate for
fixtures would be the client-side bypass this capability already forbids,
reached by another route.

#### Scenario: Fixtures do not run for an unblessed rule

- **WHEN** `test` runs against a runtime rule whose signature no reconcile has blessed, without the escape flag
- **THEN** no fixture case SHALL be executed

#### Scenario: The documented escape runs fixtures

- **WHEN** `test` runs with `--dangerously-run-scripts`
- **THEN** fixture cases SHALL execute under that flag's existing warning
- **AND** under no other mechanism
