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
- declares a `NO` matcher before every `YES` matcher (with `BasedOnStyles` empty a rule is off until a `YES`, so such a `NO` is either dead or overridden by the `YES` that follows; no config means it)

The schema SHALL report, without rejecting, a config that:

- assigns the same key twice inside one matcher (Vale 3.21.0 keeps the last assignment; 3.20.0 kept the first)
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

#### Scenario: A disable that precedes every enable is rejected

- **WHEN** a rule's config declares `[docs/legacy/**]` with `<id>.<id> = NO` and then `[docs/**]` with `<id>.<id> = YES`
- **THEN** `verify` SHALL reject the rule, naming the `NO` matcher and the `YES` that re-enables it

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

A disable therefore SHALL be declared **after** the enable it narrows, within the rule's own config; the config schema rejects a `NO` matcher that precedes every `YES`. Because precedence is positional and the run config is assembled, **assembly SHALL be deterministic**: rules ordered by id, and each rule's own matcher order preserved verbatim. A non-deterministic assembly would make a rule's effective scope depend on directory iteration order.

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
- **AND** the Vale run SHALL be refused rather than assembled without that rule's config

### Requirement: Vale diagnostics on a successful run are surfaced as notices

When Vale exits zero and writes to stderr, the CLI SHALL surface that output as a notice on the check result. A notice SHALL NOT affect the exit code.

This is the last line of defence, not the first. The case that motivated it — a rule assignment placed at the top level of the file, which Vale reports as ignoring with `W101` on stderr, a zero exit, and a well-formed empty result — is now rejected by the config schema at `verify` and at assembly, so Vale is never run over it. The requirement remains for every diagnostic the schema cannot foresee: Vale's own warnings about a style file, a format, or a config key that a future Vale adds. Discarding that output would leave the author with a rule that verifies, runs, and reports nothing, which is the silent-disable failure this engine's design exists to prevent.

#### Scenario: An ignored rule assignment reaches the user

- **WHEN** `.vale.ini` enables a rule outside any section and `check` runs
- **THEN** the config schema SHALL reject that rule before Vale is invoked, naming the line
- **AND** the rejection SHALL reach the user as the Vale engine's failure rather than as a notice

#### Scenario: A diagnostic on a run that exits zero reaches the user

- **WHEN** Vale exits zero and writes a diagnostic to stderr during `check`
- **THEN** the CLI SHALL surface that diagnostic as a notice on the result

#### Scenario: A diagnostic does not fail the check

- **WHEN** Vale exits zero, writes a diagnostic to stderr, and reports no findings
- **THEN** the check SHALL exit zero

#### Scenario: Silence stays silent

- **WHEN** Vale exits zero and writes nothing to stderr
- **THEN** the CLI SHALL add no notice
