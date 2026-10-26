## MODIFIED Requirements

### Requirement: Vale rules are verified with per-rule fixture subdirectories

The system SHALL verify a Vale rule from the case directories under `.taskless/rules/vale/<rule>/tests/pass/` and `tests/fail/`, as `cli-rule-fixtures` describes. Because verification isolates one rule, the system SHALL generate an ephemeral config assembled from that rule's own `.vale.ini` alone, so verification exercises the scope the rule actually declares. Verification SHALL assert that every `fail/` case produces at least one finding for the rule and every `pass/` case produces none.

The config SHALL be the rule's own matchers, not a blanket `[*]` enabling the rule everywhere. This requirement always said verification exercises the declared scope, and the implementation did not: it enabled the rule under `[*]`, so a rule whose matchers matched nothing real passed verification and stayed silent in `check`. The blanket config is still the right tool for one thing, the unscoped re-run that diagnoses a quiet `fail/` case.

#### Scenario: Verification isolates the rule under test

- **WHEN** verify runs for a rule and generates a config enabling only that rule
- **THEN** findings from other rules SHALL NOT affect its result

#### Scenario: Verification applies the rule's own matchers

- **WHEN** a rule's `.vale.ini` enables it only under `[docs/**/*.md]`, and a `fail/` case holds the offending text at `notes.md`
- **THEN** that case SHALL produce no finding and verification SHALL fail
- **AND** the same text at `docs/guide/notes.md` in the case SHALL produce a finding

#### Scenario: Verification fails when a fail fixture does not trigger

- **WHEN** a `fail/` case for a rule produces no finding
- **THEN** verification reports a failure for that rule

#### Scenario: A one-sided fixture set is not verified

- **WHEN** a rule has `fail/` fixtures but no `pass/` fixtures, or `pass/` fixtures but no `fail/`
- **THEN** verification reports the rule as unverified rather than passing
- **AND** the result distinguishes a half-written fixture set from a rule with no fixtures at all

### Requirement: A Vale rule is a self-contained directory

The system SHALL store a Vale rule as a directory `.taskless/rules/vale/<id>/` containing its style file `<id>.yml`, its own `.vale.ini`, and its fixtures under `tests/`. No file outside that directory SHALL be required to define or verify the rule.

Self-containment is what removes the engine's silent-failure class. A rule can be added, reviewed, moved, or deleted as one directory, and no two authors write the same file.

The rule's config SHALL be named `.vale.ini` rather than carrying a `.yml` extension. Measured: a `.yml` file inside a style directory is loaded as a rule and fails `E201` when the style is enabled wholesale, while a non-`.yml` file in the same directory is ignored.

Scope SHALL NOT be expressed inside the style file. Measured: Vale rejects unknown top-level keys in a rule with `E201 has invalid keys`.

#### Scenario: A rule is complete in one directory

- **WHEN** a rule directory contains its style and its config
- **THEN** the rule is fully defined without editing any shared file

#### Scenario: The rule config is invisible to Vale's style loader

- **WHEN** a rule directory contains `.vale.ini` beside its style
- **THEN** Vale SHALL NOT attempt to load it as a rule

#### Scenario: Deleting a rule is deleting a directory

- **WHEN** a rule directory is removed
- **THEN** no other rule's scope changes
- **AND** no shared file needs editing
