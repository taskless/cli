## MODIFIED Requirements

### Requirement: A delivered file set is verified against its signatures

Before writing any file of a served rule, the CLI SHALL verify that every signature names a
delivered file, that every delivered file outside `tests/` has exactly one signature, and that
the algoVersion-1 `canonicalHash` of each such file's content equals its signature. For a
runtime rule it SHALL also verify that the singular `signature` equals the `check.ts` entry.
Any failure SHALL refuse the whole rule and write nothing.

A served file under the legacy `.tests/` directory SHALL be treated as a fixture for this check,
like a file under `tests/`. A service that has not yet moved to the new layout still serves its
fixtures there, unsigned, and refusing them as unsigned files would refuse every rule it serves.

#### Scenario: A corrupted file is refused

- **WHEN** a served file's content does not hash to its entry in `signatures`
- **THEN** the CLI SHALL refuse the rule naming the file
- **AND** SHALL write nothing for it

#### Scenario: An unsigned file is refused

- **WHEN** a served file outside `tests/` has no entry in `signatures`
- **THEN** the CLI SHALL refuse the rule

#### Scenario: Fixtures need no signature

- **WHEN** a served rule carries files under `tests/` that have no entry in `signatures`
- **THEN** the CLI SHALL accept them

#### Scenario: Legacy fixtures need no signature either

- **WHEN** a served rule carries files under `.tests/` that have no entry in `signatures`
- **THEN** the CLI SHALL accept them as fixtures

### Requirement: A delivered rule replaces its directory

After verification, the CLI SHALL write a served rule so that its directory holds exactly the
served files: every file in the directory that the served set does not contain SHALL be removed,
including under `tests/`, since a served set always carries the rule's fixtures. The CLI SHALL
create each served file's parent directories as needed, so a nested path such as
`captures/env.yml` or `tests/fail/case.ts` is written wherever it lands. When a stale file cannot be removed, the CLI SHALL say that the served
bytes were written and name each entry it could not remove.

A served set whose fixtures are in the old format, under `.tests/`, SHALL be migrated just in
time: converted the same way migration 12 converts a local rule, written in the `tests/`
layout, and never written under `.tests/`. Fixtures carry no signature, so the conversion
changes no signed byte, and the CLI never writes a layout its own `verify` does not read. This
is a permanent reading of the old format, not a transition step. The CLI SHALL NOT depend on
the service emitting the new layout, and a served set already in the new layout SHALL be
written unchanged. Fixtures the converter cannot place SHALL be written under
`tests/` as served, and the delivery SHALL say so, naming them.

#### Scenario: A local extra file does not survive

- **WHEN** a rule directory holds `captures/extra.yml` and the served set does not
- **THEN** after the write `captures/extra.yml` SHALL NOT exist

#### Scenario: Nested paths are written

- **WHEN** a served set carries `tests/fail/case.ts` and the rule directory does not exist
- **THEN** the CLI SHALL create `tests/fail/` and write the file

#### Scenario: Legacy fixture paths are written in the new layout

- **WHEN** a served `sg` rule carries its fixtures as `.tests/<id>-test.yml` with `valid:` and `invalid:` snippets
- **THEN** the CLI SHALL write them as case directories under `tests/pass/` and `tests/fail/`
- **AND** the rule directory SHALL NOT contain `.tests/` afterwards

#### Scenario: A served set in the new layout is written as served

- **WHEN** a served set carries its fixtures under `tests/pass/<case>/` and `tests/fail/<case>/`
- **THEN** the CLI SHALL write them at those paths without conversion

#### Scenario: A generated rule's revision is confirmed

- **WHEN** `rule create` or `rule improve` fetches a produced rule whose served `revisionId` differs from the one the request reported
- **THEN** the CLI SHALL refuse that rule and write nothing for it
