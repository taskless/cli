## MODIFIED Requirements

### Requirement: A delivered rule replaces its directory

After verification, the CLI SHALL write a served rule so that its directory holds exactly the
served files: every file in the directory that the served set does not contain SHALL be removed,
including under `tests/`, since a served set always carries the rule's fixtures. The CLI SHALL
create each served file's parent directories as needed, so a nested path such as
`captures/env.yml` or `tests/fail/eval-call/case.ts` is written wherever it lands. The CLI
SHALL write the served set in full into a staging directory and move it over the rule
directory as a unit, so the old directory is removed whole, every entry in it included, and
there is no outcome in which the served bytes are written while a stale entry beside them
survives.

A served set whose fixtures are in the old format, under `.tests/`, SHALL be migrated just in
time: converted the same way migration 12 converts a local rule, written in the `tests/`
layout, and never written under `.tests/`. Fixtures carry no signature, so the conversion
changes no signed byte, and the CLI never writes a layout its own `verify` does not read. This
is a permanent reading of the old format, not a transition step. The CLI SHALL NOT depend on
the service emitting the new layout, and a served set already in the new layout SHALL be
written unchanged. A rule served with several legacy test files SHALL keep every snippet:
case names SHALL NOT collide across them, nor with a case the served set already carries
under `tests/`, nor with the name a fixture moved as served keeps. `sg test`'s
`__snapshots__/` SHALL be dropped and named. Fixtures the converter cannot place SHALL be written
under `tests/` at their served path below `.tests/`, and the delivery SHALL say so, naming them.
`verify` then refuses them by path, so an unplaced fixture is never mistaken for a passing one.

#### Scenario: A local extra file does not survive

- **WHEN** a rule directory holds `captures/extra.yml` and the served set does not
- **THEN** after the write `captures/extra.yml` SHALL NOT exist

#### Scenario: Nested paths are written

- **WHEN** a served set carries `tests/fail/eval-call/case.ts` and the rule directory does not exist
- **THEN** the CLI SHALL create `tests/fail/eval-call/` and write the file

#### Scenario: Legacy fixture paths are written in the new layout

- **WHEN** a served `sg` rule carries its fixtures as `.tests/<id>-test.yml` with `valid:` and `invalid:` snippets
- **THEN** the CLI SHALL write them as case directories under `tests/pass/` and `tests/fail/`
- **AND** the rule directory SHALL NOT contain `.tests/` afterwards

#### Scenario: Several legacy test files keep every snippet

- **WHEN** a served `sg` rule carries two legacy test files, each with one `invalid:` snippet
- **THEN** the CLI SHALL write two `fail/` cases, one per snippet

#### Scenario: A served set in both layouts keeps its cases apart

- **WHEN** a served `sg` rule carries `tests/fail/fail-01/` and a legacy test file with one `invalid:` snippet
- **THEN** the CLI SHALL write the converted snippet as `tests/fail/fail-02/`
- **AND** `tests/fail/fail-01/` SHALL hold only what was served there

#### Scenario: A fixture the converter cannot place is written and named

- **WHEN** a served `sg` rule's `files:` and `ignores:` admit no path the converter can derive for its `.tests/<id>-test.yml`
- **THEN** the CLI SHALL write that file at `tests/<id>-test.yml`, not under `.tests/`
- **AND** the delivery SHALL warn, naming the file and why
- **AND** the next `verify` of the rule SHALL report `tests/<id>-test.yml` as a stray entry

#### Scenario: A served set in the new layout is written as served

- **WHEN** a served set carries its fixtures under `tests/pass/<case>/` and `tests/fail/<case>/`
- **THEN** the CLI SHALL write them at those paths without conversion

#### Scenario: A generated rule's revision is confirmed

- **WHEN** `rule create` or `rule improve` fetches a produced rule whose served `revisionId` differs from the one the request reported
- **THEN** the CLI SHALL refuse that rule and write nothing for it

#### Scenario: An entry the old directory held is gone after the write

- **WHEN** a rule directory holds `notes.md` and `tests/pass/old/old.ts`, and the served set names neither
- **THEN** after the write the rule directory SHALL hold exactly the served files
