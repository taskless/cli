## RENAMED Requirements

- FROM: `### Requirement: The corpus publishes what verify enforces beyond the engine`
- TO: `### Requirement: The corpus publishes what validate and verify enforce beyond the engine`

## MODIFIED Requirements

### Requirement: The CLI publishes a conformance corpus

The CLI SHALL publish `assets/reference.json` as the package export
`@taskless/cli/reference.json`, carrying a `version`, the `protocol` the corpus
exists to support, the `constraints` `validate` and `verify` enforce beyond an
engine's own schema, and one entry per shipped demonstration rule.

The corpus SHALL be built from the shipped rules rather than restating them, so
what another team grades against and what the CLI writes into a project cannot
come to describe different things.

`version` SHALL be incremented whenever a consumer would have to change code to
keep reading the artifact. A consumer that asserts the version and stops is
behaving correctly, so the bump is the only signal the corpus owes it.

#### Scenario: The corpus is reachable as a published export

- **WHEN** the package is installed from the registry
- **THEN** `assets/reference.json` SHALL be among the published files
- **AND** the export map SHALL name `./reference.json`

#### Scenario: The corpus separates the rule from its cases

- **WHEN** a consumer reads a corpus entry
- **THEN** the files a generator must produce SHALL be carried apart from the cases both sides' rules must satisfy
- **AND** no file SHALL appear in both

### Requirement: The corpus publishes what validate and verify enforce beyond the engine

The corpus SHALL carry every entry in `RULE_CONSTRAINTS`, each with a stable
`id`, the `engine` it applies to, which command enforces it, a summary, and the
rationale behind it.

Published because a generator that never reads the CLI's recipes cannot know
these, and because without the list a refusal is indistinguishable from a
disagreement about the subject the rule addresses.

#### Scenario: A constraint says which command enforces it

- **WHEN** a consumer plans the order of an evaluation
- **THEN** each constraint SHALL state whether `validate` or `verify` refuses the rule

#### Scenario: Renaming the enforcing commands bumps the corpus version

- **WHEN** the commands an `enforcedBy` value names are renamed, so an existing value would mean a different command
- **THEN** the corpus `version` SHALL be incremented
- **AND** a consumer reading the new version SHALL find only the current command names among the `enforcedBy` values
