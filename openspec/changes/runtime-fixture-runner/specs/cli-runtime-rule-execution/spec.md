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

### Requirement: Fixture execution is gated on the escape flag alone

Executing a fixture case SHALL require `--dangerously-run-scripts`, and SHALL be
permitted under no other mechanism. No rule identifier SHALL be exempt, and a
blessed signature SHALL NOT substitute for the flag. Deciding this SHALL NOT
involve the rule service: no token SHALL be read, no organization resolved, and
no reconcile performed.

**Rationale.** That the input is test data is a statement about the input, not
about what the program may do, so the fixture path SHALL NOT be a softer gate
than the scan path. It is a stricter one, and for a reason that is about consent
rather than about the bytes. A scan executes rules as a **side effect** of a
request for a report, so a gate has to stand between the two or code runs
silently; that gate is what a reconcile serves. Running fixtures is the request
itself, so the verb is the consent and the flag is the confirmation.

Reconciling here would also buy nothing. The only rule it could ever admit is
one the service already verified before delivering it, while a locally authored
rule has no signature and never will — so for the audience that runs fixtures it
is a network round trip whose answer is always "no".

#### Scenario: Fixtures do not run without the flag

- **WHEN** `test` runs against a runtime rule without `--dangerously-run-scripts`
- **THEN** no fixture case SHALL be executed
- **AND** this SHALL hold irrespective of authentication state or any signature the rule carries

#### Scenario: The documented escape runs fixtures

- **WHEN** `test` runs with `--dangerously-run-scripts`
- **THEN** fixture cases SHALL execute under that flag's existing warning
- **AND** under no other mechanism

#### Scenario: A scan's gate is unaffected

- **WHEN** `check` scans a repository holding a runtime rule
- **THEN** it SHALL apply its existing policy unchanged: a signature returned in `run` by an authenticated reconcile, or `--dangerously-run-scripts`
- **AND** the fixture runner SHALL NOT alter what a scan executes
