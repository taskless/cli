## ADDED Requirements

### Requirement: A rule's Vale config is validated against a schema before it is assembled

The system SHALL parse each rule's `.vale.ini` into an ordered, lossless AST and validate that AST against a schema keyed by the rule's directory id, before the config is assembled into the run config and when the rule is verified. Validation SHALL be performed on the parsed structure, never by matching the file's text.

The schema SHALL reject a config that:

- assigns any property above its first matcher (`StylesPath`, `MinAlertLevel`, or anything else; Vale ignores such a line with a `W101` warning and the rule verifies clean while enabled nowhere)
- declares a matcher without a `tskl) rule = <id>` breadcrumb naming this rule
- assigns a key other than `<id>.<id>` (a `<style>.<check>` key naming any other rule is a cross-rule override)
- assigns a value other than `YES` or `NO`
- sets `BasedOnStyles` to anything but empty
- declares no matcher
- never assigns `<id>.<id> = YES`

The schema SHALL report, without rejecting, a config that:

- assigns the same key twice inside one matcher (Vale 3.21.0 keeps the last assignment; 3.20.0 kept the first)
- declares a `NO` matcher before every `YES` matcher (a disable that precedes the enable it narrows is re-enabled by it)
- declares a `[*]` matcher
- declares a matcher under `.taskless/**` (`check` excludes that tree before Vale runs, so the matcher acts only under a bare `vale` invocation)

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

#### Scenario: A repeated key is reported, not rejected

- **WHEN** one matcher assigns `<id>.<id> = YES` and then `<id>.<id> = NO`
- **THEN** `verify` SHALL accept the rule and report the repeat as a notice
- **AND** `check` SHALL run the Vale engine and carry the same text in its notices

#### Scenario: A `.taskless/**` matcher is reported as unnecessary

- **WHEN** a rule's config declares a matcher under `.taskless/**`
- **THEN** `verify` SHALL accept the rule and report that `check` already excludes that tree

#### Scenario: An accepted config is assembled byte-for-byte

- **WHEN** a config passes the schema
- **THEN** the assembled run config SHALL contain that file's bytes unchanged under the rule's breadcrumb comment
- **AND** the matcher patterns reported for the run SHALL equal the section names in the parsed structure

## MODIFIED Requirements

### Requirement: Per-rule scoping is expressed in the rule's own Vale config

The system SHALL express a Vale rule's scope through **matchers** — `[<glob>]` sections — declared in that rule's own `.taskless/rules/vale/<id>/.vale.ini`. Include is `<id>.<id> = YES`, exclude is `<id>.<id> = NO`.

Precedence is **positional**, and the system SHALL order matchers accordingly rather than relying on a disable to win on its own. Measured against Vale 3.21.0:

- Where two matchers both match a file, the **last** one wins for that rule.
- Where the same key is assigned twice inside one matcher — including across duplicate `[<glob>]` sections, which Vale merges — the **last** assignment wins. Through Vale 3.20.0 the first assignment won here; 3.21.0 made the two directions agree.

A disable therefore SHALL be declared **after** the enable it narrows, within the rule's own config. Because precedence is positional and the run config is assembled, **assembly SHALL be deterministic**: rules ordered by id, and each rule's own matcher order preserved verbatim. A non-deterministic assembly would make a rule's effective scope depend on directory iteration order.

A rule SHALL NOT be able to override another rule's matchers. It cannot know its own position in the assembled file, and cross-rule overriding through a shared file is the coupling the per-rule layout removes. The config schema enforces this: an assignment key naming any rule but the config's own is a rejection, at `verify` and at assembly.

#### Scenario: A rule scopes itself

- **WHEN** a rule's own config enables it under `[marketing/**]`
- **THEN** the rule produces findings in `marketing/` files and none in `api/` files

#### Scenario: A rule narrows itself

- **WHEN** a rule's config enables it under `[marketing/**]` and then disables it under `[marketing/legacy/**]`
- **THEN** the rule fires in `marketing/` but not in `marketing/legacy/`

#### Scenario: A repeated key keeps its last assignment

- **WHEN** a rule's config assigns `<id>.<id> = YES` and then `<id>.<id> = NO` inside one matcher, or across two `[<glob>]` sections with the same glob
- **THEN** the rule does not fire on a matching file
- **AND** the reverse order fires

#### Scenario: Assembly order is stable

- **WHEN** the same set of rules is assembled twice
- **THEN** the resulting config SHALL be byte-identical
- **AND** each rule's matchers SHALL appear in the order that rule declared them

#### Scenario: Duplicate matchers merge

- **WHEN** two rules each declare a `[*.md]` matcher
- **THEN** both rules run on a matching `.md` file (Vale merges the matchers)

#### Scenario: A rule cannot assign another rule's key

- **WHEN** `no-simply/.vale.ini` assigns `no-hedging.no-hedging = NO`
- **THEN** `verify` SHALL reject `no-simply`, naming the foreign key
- **AND** the assembled run config SHALL NOT be written with that line in it
