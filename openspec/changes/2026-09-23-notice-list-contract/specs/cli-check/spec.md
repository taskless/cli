## ADDED Requirements

### Requirement: Notices render one marker per notice and publish as a flat list

`check` SHALL carry advisory messages as an ordered list in which one element is one notice, and SHALL NOT join several notices into one element.

In human output the CLI SHALL prefix EVERY line it prints of a notice with the `Notice: ` marker, including the second and later lines of a notice that spans lines. A notice may legitimately span lines — an engine's own diagnostic output is passed through as written — so a marker on the first line alone leaves the rest reading as unlabelled stray output, which is the failure this requires against.

Under `--json` the `notices` array SHALL be flat: each element SHALL be exactly one notice. A consumer SHALL NOT be required to split an element on a separator, because no separator between notices is published and none is part of the contract.

A notice SHALL NOT affect the exit code.

#### Scenario: Two independent advisories each get their own marker

- **WHEN** a `check` run produces two independent notices and human output is rendered
- **THEN** each notice SHALL be printed on its own line behind its own `Notice: ` marker

#### Scenario: Every line of a multi-line notice is marked

- **WHEN** a single notice spans several lines and human output is rendered
- **THEN** the CLI SHALL print each of its lines behind a `Notice: ` marker

#### Scenario: A machine consumer receives one notice per element

- **WHEN** a `check --json` run produces two independent notices
- **THEN** the `notices` array SHALL hold two elements, one notice each

#### Scenario: Nothing to say publishes nothing

- **WHEN** a `check` run produces no notices
- **THEN** human output SHALL print no `Notice: ` line
- **AND** `--json` SHALL omit the `notices` field
