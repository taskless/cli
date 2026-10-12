## MODIFIED Requirements

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

- **WHEN** `verify` runs against a runtime rule without `--dangerously-run-scripts`
- **THEN** no fixture case SHALL be executed
- **AND** this SHALL hold irrespective of authentication state or any signature the rule carries

#### Scenario: The documented escape runs fixtures

- **WHEN** `verify` runs with `--dangerously-run-scripts`
- **THEN** fixture cases SHALL execute under that flag's existing warning
- **AND** under no other mechanism

#### Scenario: A scan's gate is unaffected

- **WHEN** `check` scans a repository holding a runtime rule
- **THEN** it SHALL apply its existing policy unchanged: a signature returned in `run` by an authenticated reconcile, or `--dangerously-run-scripts`
- **AND** the fixture runner SHALL NOT alter what a scan executes
