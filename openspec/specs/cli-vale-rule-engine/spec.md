# cli-vale-rule-engine Specification

## Purpose

How Vale runs as a static-tier engine: its per-rule fixtures, its subprocess timeout, the run config it is given, and how its findings become engine-agnostic results.

## Requirements

### Requirement: Vale runs in the static tier without reconciliation or signing

The system SHALL treat Vale as a static-tier engine — always run, with no server reconciliation or signature verification. Vale's `script` checks execute in a sandbox that exposes only pure-computation modules (`text`/`math`/`fmt`) with no host access, so a Vale rule is inert data equivalent in trust to a static ast-grep rule.

#### Scenario: Vale runs when anonymous

- **WHEN** the CLI runs a check while logged out or anonymous
- **THEN** Vale rules are executed the same as ast-grep static rules, with no reconcile or signing step

### Requirement: Vale findings map to the scanner-agnostic CheckResult

The system SHALL map each Vale finding to a `CheckResult` with `source` `"vale"` and `ruleId` equal to the Vale check name with its `rules.` prefix stripped. Severity SHALL be normalized `error → error`, `warning → warning`, `suggestion → hint`. The system SHALL map `message` from `Message`, `note` from `Description`/`Link`, `range` from `Line`/`Span`, `matchedText` from `Match`, and `fix` from `Action` only when the action is populated.

#### Scenario: Finding maps to CheckResult

- **WHEN** Vale reports a finding `{Check: "rules.no-simply", Severity: "warning", Line: 3, Span: [1,7], Message: "Avoid 'simply'", Match: "simply"}` in `docs/a.md`
- **THEN** the CLI emits a `CheckResult` with `source` `"vale"`, `ruleId` `"no-simply"`, `severity` `"warning"`, `message` `"Avoid 'simply'"`, `file` `"docs/a.md"`, and a `range` derived from line 3 / span 1–7

### Requirement: A Vale check is bounded by a subprocess timeout

The system SHALL bound each Vale invocation with a timeout and, on expiry, terminate the process and report the timeout rather than hanging.

#### Scenario: Runaway Vale invocation is terminated

- **WHEN** a Vale invocation exceeds its timeout
- **THEN** the CLI terminates the process and reports a timeout for the Vale engine without hanging the overall check

### Requirement: A missing Vale binary is reported without failing other engines

When the `vale` binary cannot be found or invoked, the system SHALL report that the Vale engine is unavailable and continue running other engines, rather than aborting the entire check.

#### Scenario: Vale binary absent

- **WHEN** `.taskless/vale/` has rules but the `vale` binary is not installed
- **THEN** the CLI reports the Vale engine as unavailable with an actionable message and still returns ast-grep results

### Requirement: Vale rules are verified with per-rule fixture subdirectories

The system SHALL verify a Vale rule from a `.taskless/rules/vale/<rule>/.tests/` subdirectory containing `pass/` and `fail/` fixture documents. Because verification isolates one rule, the system SHALL generate an ephemeral config enabling only that rule — derived from the rule's own config so that verification exercises the scope the rule actually declares. Verification SHALL assert that every `fail/` fixture produces at least one finding for the rule and every `pass/` fixture produces none (mirroring ast-grep's `invalid`/`valid`).

#### Scenario: Verification isolates the rule under test

- **WHEN** verify runs for a rule and generates a config enabling only that rule
- **THEN** findings from other rules SHALL NOT affect its result

#### Scenario: Verification fails when a fail fixture does not trigger

- **WHEN** a `fail/` fixture for a rule produces no finding
- **THEN** verification reports a failure for that rule

#### Scenario: A one-sided fixture set is not verified

- **WHEN** a rule has `fail/` fixtures but no `pass/` fixtures, or `pass/` fixtures but no `fail/`
- **THEN** verification reports the rule as unverified rather than passing
- **AND** the result distinguishes a half-written fixture set from a rule with no fixtures at all

### Requirement: Taskless breadcrumbs use a namespaced ignored key in the Vale config

Any Taskless-owned breadcrumb the system records in a Vale config SHALL use a `tskl) <name> = <value>` key. The system SHALL NOT rely on Vale enforcing these keys; they are read only by Taskless tooling, and Vale's ini parser accepts and ignores them.

With each rule owning its config, a matcher's owner is given by the directory it lives in, so the breadcrumb is no longer needed to locate a rule's matchers. It is retained to mark Taskless-owned matchers **within the assembled file**, where several rules' matchers are interleaved and provenance is otherwise lost.

#### Scenario: Breadcrumb key is ignored by Vale

- **WHEN** a config contains a `tskl) rule = no-simply` key
- **THEN** Vale runs normally, ignoring the key, and Taskless tooling can read it back

#### Scenario: Provenance survives assembly

- **WHEN** matchers from several rules are assembled into one run config
- **THEN** each SHALL carry the `tskl) rule` key naming the rule it came from

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

### Requirement: Vale check executes against an assembled run config over the target paths

The system SHALL assemble a run config from the per-rule configs and run `vale --config <assembled> --output=JSON --no-exit` over the resolved target paths. The assembled config SHALL set `StylesPath` naming the Vale rules tree and `MinAlertLevel = suggestion`, so that every finding surfaces to the client for normalization and filtering.

The config is assembled rather than committed because it has no single author. Every rule contributes its own matchers, and a shared committed file is one every rule's author must edit correctly — which is where the engine's silent failures were found in practice.

The assembled config SHALL be written where the run can read it and SHALL be gitignored. A generated file that is also committed drifts from its inputs and invites hand edits the next assembly discards.

#### Scenario: Check runs Vale via the assembled config

- **WHEN** the CLI runs a check and `.taskless/rules/vale/` contains rule directories
- **THEN** it assembles a run config from their per-rule configs and invokes Vale with it over the target paths

#### Scenario: The assembled config is not a source file

- **WHEN** the run config is written
- **THEN** it SHALL be ignored by version control
- **AND** editing it SHALL NOT change what a later check reports

#### Scenario: No Vale rules present

- **WHEN** `.taskless/rules/vale/` contains no rule directories
- **THEN** the CLI does not invoke Vale and produces no Vale findings

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

### Requirement: A Vale rule is a self-contained directory

The system SHALL store a Vale rule as a directory `.taskless/rules/vale/<id>/` containing its style file `<id>.yml`, its own `.vale.ini`, and its fixtures under `.tests/`. No file outside that directory SHALL be required to define or verify the rule.

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

### Requirement: A rule's Vale config is validated against a schema before it is assembled

The system SHALL parse each rule's `.vale.ini` into an ordered, lossless AST and validate that AST against a schema keyed by the rule's directory id, before the config is assembled into the run config and when the rule is verified. Validation SHALL be performed on the parsed structure, never by matching the file's text.

The schema SHALL reject a config that:

- assigns any property above its first matcher (`StylesPath`, `MinAlertLevel`, or anything else; Vale ignores such a line with a `W101` warning and the rule verifies clean while enabled nowhere)
- declares a matcher without a `tskl) rule = <id>` breadcrumb naming this rule
- assigns a key other than `<id>.<id>` (a `<style>.<check>` key naming any other rule is a cross-rule override)
- assigns a value other than `YES` or `NO`
- sets `BasedOnStyles` to anything but empty
- declares no matcher
- never assigns `<id>.<id> = YES` in its final per-matcher verdicts (matchers with the same glob are folded, as Vale merges them, and the last assignment wins, so a `YES` that a later `NO` in the same matcher overrides does not count)
- declares a `NO`-verdict matcher before every `YES`-verdict matcher (with `BasedOnStyles` empty a rule is off until a `YES`, so such a `NO` is either dead or overridden by the `YES` that follows; no config means it)

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

- **WHEN** one matcher assigns `<id>.<id> = YES` and then `<id>.<id> = NO`, and an earlier matcher assigns `<id>.<id> = YES`
- **THEN** `verify` SHALL accept the rule and report the repeat as a notice
- **AND** `check` SHALL run the Vale engine and carry the same text in its notices

#### Scenario: A rule whose only enable is overridden is rejected

- **WHEN** the only matcher assigning `<id>.<id> = YES` later assigns `<id>.<id> = NO`, in the same section or in a second section with the same glob
- **THEN** `verify` SHALL reject the rule as present but off, under `vale-config-enabled-somewhere`
- **AND** the repeat SHALL still be reported as a notice

#### Scenario: A `.taskless/**` matcher is reported as unnecessary

- **WHEN** a rule's config declares a matcher under `.taskless/**`
- **THEN** `verify` SHALL accept the rule and report that `check` already excludes that tree

#### Scenario: An accepted config is assembled byte-for-byte

- **WHEN** a config passes the schema
- **THEN** the assembled run config SHALL contain that file's bytes unchanged under the rule's breadcrumb comment
- **AND** the matcher patterns reported for the run SHALL equal the section names in the parsed structure
