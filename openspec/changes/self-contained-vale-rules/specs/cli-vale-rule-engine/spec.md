## MODIFIED Requirements

### Requirement: Vale check executes against an assembled run config over the target paths

The system SHALL assemble a run config from the per-rule configs and run `vale --config <assembled> --output=JSON --no-exit` over the resolved target paths. The assembled config SHALL set `StylesPath = rules` and `MinAlertLevel = suggestion`, so that every finding surfaces to the client for normalization and filtering.

The config is assembled rather than committed because it has no single author. Every rule contributes its own matchers, and a shared committed file is one every rule's author must edit correctly — which is where the engine's silent failures were found in practice.

The assembled config SHALL be written where the run can read it and SHALL be gitignored. A generated file that is also committed drifts from its inputs and invites hand edits the next assembly discards.

#### Scenario: Check runs Vale via the assembled config

- **WHEN** the CLI runs a check and `.taskless/vale/rules/` contains rule directories
- **THEN** it assembles a run config from their per-rule configs and invokes Vale with it over the target paths

#### Scenario: The assembled config is not a source file

- **WHEN** the run config is written
- **THEN** it SHALL be ignored by version control
- **AND** editing it SHALL NOT change what a later check reports

#### Scenario: No Vale rules present

- **WHEN** `.taskless/vale/rules/` contains no rule directories
- **THEN** the CLI does not invoke Vale and produces no Vale findings

### Requirement: Per-rule scoping is expressed in the rule's own Vale config

The system SHALL express a Vale rule's scope through **matchers** — `[<glob>]` sections — declared in that rule's own `.taskless/vale/rules/<id>/.vale.ini`. Include is `<id>.<id> = YES`, exclude is `<id>.<id> = NO`.

Precedence is **positional**, and the system SHALL order matchers accordingly rather than relying on a disable to win on its own. Measured against Vale 3.17.1:

- Where two matchers both match a file, the **last** one wins for that rule.
- Where the same key is assigned twice inside one matcher — including across duplicate `[<glob>]` sections, which Vale merges — the **first** assignment wins.

A disable therefore SHALL be declared **after** the enable it narrows, within the rule's own config. Because precedence is positional and the run config is assembled, **assembly SHALL be deterministic**: rules ordered by id, and each rule's own matcher order preserved verbatim. A non-deterministic assembly would make a rule's effective scope depend on directory iteration order.

A rule SHALL NOT be able to override another rule's matchers. It cannot know its own position in the assembled file, and cross-rule overriding through a shared file is the coupling the per-rule layout removes.

#### Scenario: A rule scopes itself

- **WHEN** a rule's own config enables it under `[marketing/**]`
- **THEN** the rule produces findings in `marketing/` files and none in `api/` files

#### Scenario: A rule narrows itself

- **WHEN** a rule's config enables it under `[marketing/**]` and then disables it under `[marketing/legacy/**]`
- **THEN** the rule fires in `marketing/` but not in `marketing/legacy/`

#### Scenario: Assembly order is stable

- **WHEN** the same set of rules is assembled twice
- **THEN** the resulting config SHALL be byte-identical
- **AND** each rule's matchers SHALL appear in the order that rule declared them

#### Scenario: Duplicate matchers merge

- **WHEN** two rules each declare a `[*.md]` matcher
- **THEN** both rules run on a matching `.md` file (Vale merges the matchers)

### Requirement: Taskless breadcrumbs use a namespaced ignored key in the Vale config

Any Taskless-owned breadcrumb the system records in a Vale config SHALL use a `tskl) <name> = <value>` key. The system SHALL NOT rely on Vale enforcing these keys; they are read only by Taskless tooling, and Vale's ini parser accepts and ignores them.

With each rule owning its config, a matcher's owner is given by the directory it lives in, so the breadcrumb is no longer needed to locate a rule's matchers. It is retained to mark Taskless-owned matchers **within the assembled file**, where several rules' matchers are interleaved and provenance is otherwise lost.

#### Scenario: Breadcrumb key is ignored by Vale

- **WHEN** a config contains a `tskl) rule = no-simply` key
- **THEN** Vale runs normally, ignoring the key, and Taskless tooling can read it back

#### Scenario: Provenance survives assembly

- **WHEN** matchers from several rules are assembled into one run config
- **THEN** each SHALL carry the `tskl) rule` key naming the rule it came from

### Requirement: Vale rules are verified with per-rule fixture subdirectories

The system SHALL verify a Vale rule from a `.taskless/vale/rule-tests/<rule>/` subdirectory containing `pass/` and `fail/` fixture documents. Because verification isolates one rule, the system SHALL generate an ephemeral config enabling only that rule — derived from the rule's own config so that verification exercises the scope the rule actually declares. Verification SHALL assert that every `fail/` fixture produces at least one finding for the rule and every `pass/` fixture produces none (mirroring ast-grep's `invalid`/`valid`).

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

## ADDED Requirements

### Requirement: A Vale rule is a self-contained directory

The system SHALL store a Vale rule as a directory `.taskless/vale/rules/<id>/` containing its style file `<id>.yml` and its own `.vale.ini`. No file outside that directory, other than the rule's fixtures, SHALL be required to define the rule.

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
