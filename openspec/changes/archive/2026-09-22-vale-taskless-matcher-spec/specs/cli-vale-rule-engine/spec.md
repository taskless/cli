## MODIFIED Requirements

### Requirement: A rule's Vale config is validated against a schema before it is assembled

The system SHALL parse each rule's `.vale.ini` into an ordered, lossless AST and validate that AST against a schema keyed by the rule's directory id, before the config is assembled into the run config and when the rule is verified. Validation SHALL be performed on the parsed structure, never by matching the file's text.

The schema SHALL reject a config that:

- assigns any property above its first matcher (`StylesPath`, `MinAlertLevel`, or anything else; Vale ignores such a line with a `W101` warning and the rule verifies clean while enabled nowhere)
- declares a matcher without a `tskl) rule = <id>` breadcrumb naming this rule
- assigns a key other than `<id>.<id>` (a `<style>.<check>` key naming any other rule is a cross-rule override)
- assigns a value other than `YES` or `NO`
- assigns `BasedOnStyles`, with any value, empty included (on Vale 3.22.0 an empty value clears every earlier matcher's settings for the file, which in the assembled config silences every other rule whose glob reaches it; a named style loads alongside every overlapping rule; and no rule config ever needed either, since no bundled style loads unless a run-level `BasedOnStyles` names one)
- declares no matcher
- never assigns `<id>.<id> = YES` in its final per-matcher verdicts (matchers with the same glob are folded, as Vale merges them, and the last assignment wins, so a `YES` that a later `NO` in the same matcher overrides does not count)
- declares a `NO`-verdict matcher before every `YES`-verdict matcher (no style is loaded, so a rule is off until a `YES`, and such a `NO` is either dead or overridden by the `YES` that follows; no config means it)

The schema SHALL report, without rejecting, a config that:

- assigns the same key twice inside one matcher (Vale 3.21.0 keeps the last assignment; 3.20.0 kept the first)
- declares a `[*]` matcher
- declares a matcher under `.taskless/**` (`check` excludes that tree from a whole-project walk, so the matcher is unnecessary there; it is not harmless, because it silences the rule on a path named explicitly, such as the rule's own fixture bucket under `.taskless/`)

A rejected config SHALL refuse the Vale engine for that `check` run: the engine reports a failure naming the rule and the offending line, that failure SHALL reach the exit code, and other engines SHALL still run. A rule with a rejected config SHALL NOT be silently omitted from the assembled config, because a rule that is present, verifies, and reports nothing is the silent-disable failure this engine's design exists to prevent. Advisories SHALL be surfaced as notices and SHALL NOT affect the exit code.

Assembly SHALL write each accepted config's source verbatim. The parsed structure is read for validation and for the list of matcher patterns; it is not re-serialized.

#### Scenario: A foreign assignment refuses the run

- **WHEN** `no-simply/.vale.ini` assigns `no-hedging.no-hedging = NO` and `check` runs
- **THEN** the Vale engine SHALL report a failure naming `no-simply` and that line
- **AND** the exit code SHALL be non-zero
- **AND** ast-grep results for the same run SHALL still be reported

#### Scenario: A run-level key in a rule config is rejected

- **WHEN** a rule's config places `StylesPath = .` above its first matcher
- **THEN** `verify` SHALL reject the rule, naming the key and the line
- **AND** `check` SHALL refuse the Vale engine rather than strip the line

#### Scenario: A matcher without a breadcrumb is rejected

- **WHEN** a rule's config declares `[*.md]` with `<id>.<id> = YES` and no `tskl) rule` key
- **THEN** `verify` SHALL reject the rule, naming the matcher

#### Scenario: A disable that precedes every enable is rejected

- **WHEN** a rule's config declares `[docs/legacy/**]` with `<id>.<id> = NO` and then `[docs/**]` with `<id>.<id> = YES`
- **THEN** `verify` SHALL reject the rule, naming the `NO` matcher and the `YES` that re-enables it

#### Scenario: A BasedOnStyles assignment is rejected

- **WHEN** a rule's config sets `BasedOnStyles =` inside a matcher
- **THEN** `verify` SHALL reject the rule under `vale-config-no-based-on-styles`, naming the line and saying that the line silences the other rules whose globs overlap
- **AND** a `BasedOnStyles` naming a style SHALL be rejected under the same constraint

#### Scenario: A [formats] section is rejected as a matcher it cannot be

- **WHEN** a rule's config declares a `[formats]` section
- **THEN** `verify` SHALL reject it for the breadcrumb it lacks and the foreign key it assigns, so no rule config can move a file between parser tiers

#### Scenario: A repeated key is reported, not rejected

- **WHEN** one matcher assigns `<id>.<id> = YES` and then `<id>.<id> = NO`, and an earlier matcher assigns `<id>.<id> = YES`
- **THEN** `verify` SHALL accept the rule and report the repeat as a notice
- **AND** `check` SHALL run the Vale engine and carry the same text in its notices

#### Scenario: A rule whose only enable is overridden is rejected

- **WHEN** the only matcher assigning `<id>.<id> = YES` later assigns `<id>.<id> = NO`, in the same section or in a second section with the same glob
- **THEN** `verify` SHALL reject the rule as present but off, under `vale-config-enabled-somewhere`
- **AND** the repeat SHALL still be reported as a notice

#### Scenario: A `.taskless/**` matcher is reported as unnecessary

- **WHEN** a rule's config declares a matcher under `.taskless/**`
- **THEN** `verify` SHALL accept the rule and report both halves: that the matcher is unnecessary on a whole-project check, which excludes `.taskless/` before Vale runs, AND that it silences the rule on a path named explicitly, such as the rule's own fixture bucket
- **AND** `check` SHALL carry the same text in its notices

#### Scenario: An accepted config is assembled byte-for-byte

- **WHEN** a config passes the schema
- **THEN** the assembled run config SHALL contain that file's bytes unchanged under the rule's breadcrumb comment
- **AND** the matcher patterns reported for the run SHALL equal the section names in the parsed structure
