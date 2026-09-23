## ADDED Requirements

### Requirement: Test reports the findings an ast-grep rule's fixtures produced

`test` SHALL report, for an ast-grep rule whose fixtures produced matches, the findings those fixtures produced, in the same shape the other engines report theirs. A consumer SHALL NOT be able to tell which engine produced a finding except by its `source`.

The rendered `message` is what this exists for. `ast-grep test` decides only whether each `invalid:` snippet fired and each `valid:` one stayed quiet, and a rule whose message interpolates its metavariables can have the slots in the wrong order while satisfying both — so the verdict cannot see the defect and the message is the only thing that can.

The findings SHALL be gathered independently of the verdict and SHALL NOT change it. `ast-grep test` remains what decides whether the rule passed; a failure to gather findings SHALL be reported as a rule with no findings rather than as a rule that failed.

A finding SHALL name the fixture FILE that declares the snippet, as a project-relative path, not the temporary or synthetic name any scanning mechanism used internally. Where the snippet is a literal block scalar, the position SHALL be the snippet's real position in that file, so the author can open it directly.

#### Scenario: The rendered message is reported, not just the verdict

- **WHEN** `test --json` runs against an ast-grep rule whose `invalid:` snippet matched
- **THEN** the rule result SHALL carry a finding for that snippet
- **AND** the finding's `message` SHALL be the message as ast-grep rendered it, with the rule's metavariables already interpolated
- **AND** a rule whose message names the same metavariables in the other order SHALL produce a different `message`, so the two cannot both pass

#### Scenario: A finding points back into the fixture file

- **WHEN** an ast-grep fixture snippet produces a finding
- **THEN** the finding's `file` SHALL be the project-relative path of the test YAML declaring the snippet
- **AND** SHALL NOT be a temporary path or ast-grep's name for a stream
- **AND** where the snippet is a literal block scalar, the finding's line and column SHALL be its position in that file rather than its position within the snippet

#### Scenario: Both buckets are reported, and named in ast-grep's vocabulary

- **WHEN** `test --json` reports an ast-grep rule's findings
- **THEN** a finding from an `invalid:` snippet SHALL carry the `fail` bucket
- **AND** a finding from a `valid:` snippet SHALL carry the `pass` bucket
- **AND** the `fail` bucket SHALL be reported even when the rule passed

#### Scenario: A valid snippet that wrongly fired is printed without --json

- **WHEN** `test` runs without `--json` and an ast-grep rule fails because a `valid:` snippet fired
- **THEN** the offending findings SHALL be printed under that rule, labelled by bucket
- **AND** they SHALL be rendered the way `check` renders a finding
- **AND** a rule that passed SHALL still print one line and no findings

#### Scenario: A language ast-grep cannot parse degrades to no findings

- **WHEN** an ast-grep rule declares a `language:` the vendored binary does not recognise
- **THEN** `test` SHALL report that rule as carrying an empty `findings` array
- **AND** SHALL NOT fail to produce a report
- **AND** the failure SHALL NOT suppress any other rule's findings

#### Scenario: Collecting findings writes nothing to disk

- **WHEN** `test` collects an ast-grep rule's fixture findings, whether the rule passes or fails
- **THEN** no file SHALL be left behind in the project tree or the temporary directory
- **AND** nothing SHALL be written that a later `check` could report against
