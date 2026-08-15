## ADDED Requirements

### Requirement: The scaffolded Vale config carries no section

The `.vale.ini` written when a project is scaffolded SHALL contain `StylesPath` and `MinAlertLevel` and no section. A project therefore lints nothing with Vale until someone scopes something deliberately.

An unscoped `[*]` applies every enabled rule to every file the walk reaches, which makes the default the most aggressive scope available rather than the narrowest. Scope is the author's decision, and the scaffold SHALL NOT make it on their behalf.

#### Scenario: A freshly scaffolded project reports nothing

- **WHEN** `check` runs against a scaffolded project with a rule file present and no section added
- **THEN** Vale SHALL report no findings
- **AND** the run SHALL NOT be reported as an engine failure

#### Scenario: Scope is added by the author

- **WHEN** an author scopes a rule by adding a section
- **THEN** only files matching that section SHALL be subject to it

### Requirement: Vale diagnostics on a successful run are surfaced as notices

When Vale exits zero and writes to stderr, the CLI SHALL surface that output as a notice on the check result. A notice SHALL NOT affect the exit code.

This is a precondition of the section-less scaffold rather than an independent improvement. With no section to copy, the likely first edit is a rule assignment at the top level of the file, which Vale reports as ignoring — on stderr, with a zero exit and a well-formed empty result. Discarding that output leaves the author with a rule that verifies, runs, and reports nothing, which is the silent-disable failure this engine's design exists to prevent.

#### Scenario: An ignored rule assignment reaches the user

- **WHEN** `.vale.ini` enables a rule outside any section and `check` runs
- **THEN** the CLI SHALL surface Vale's diagnostic that the assignment was ignored

#### Scenario: A diagnostic does not fail the check

- **WHEN** Vale exits zero, writes a diagnostic to stderr, and reports no findings
- **THEN** the check SHALL exit zero

#### Scenario: Silence stays silent

- **WHEN** Vale exits zero and writes nothing to stderr
- **THEN** the CLI SHALL add no notice
