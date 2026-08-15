# cli-rule-format Specification

## Purpose

TBD - created by archiving change partition-rules-by-engine. Update Purpose after archive.
## Requirements
### Requirement: A rule's engine is determined by its containing directory

The system SHALL dispatch each rule to the engine named by its top-level `.taskless/<engine>/` directory, and SHALL NOT parse a rule file to determine its engine.

#### Scenario: Directory-based dispatch

- **WHEN** a rule file exists at `.taskless/sg/rules/no-eval.yml` and another at `.taskless/vale/rules/no-simply.yml`
- **THEN** the first is executed by ast-grep and the second by Vale, based solely on directory

### Requirement: Migration preserves existing ast-grep rules by moving them under sg

The migration to the engine-partitioned layout SHALL move the existing `.taskless/rules/`, `.taskless/rule-tests/`, and `.taskless/sgconfig.yml` under `.taskless/sg/` without editing file contents, relying on `sgconfig.yml`'s relative `ruleDirs: [rules]` remaining valid after the move. It SHALL scaffold `.taskless/vale/` and SHALL move `.taskless/runtime-rules/` to `.taskless/runtime/rules/` and `.taskless/runtime-rule-tests/` to `.taskless/runtime/rule-tests/` without editing file contents (preserving runtime capture-rule hashes). Every scaffolded directory that would otherwise be empty SHALL contain a `.gitkeep` file so the structure is tracked reliably.

#### Scenario: Mechanical move of legacy rules

- **WHEN** the migration runs against a `.taskless/` containing `rules/`, `rule-tests/`, and `sgconfig.yml`
- **THEN** those become `sg/rules/`, `sg/rule-tests/`, and `sg/sgconfig.yml`, and `sg scan --config .taskless/sg/sgconfig.yml` runs the same rules as before the move

#### Scenario: Vale scaffolded, runtime moved

- **WHEN** the migration runs
- **THEN** `.taskless/vale/` is created with empty `rules/` and `rule-tests/`, and `.taskless/runtime-rules/` becomes `.taskless/runtime/rules/` with byte-identical contents

### Requirement: Service-delivered rules without an engine are written as ast-grep

The rule ingest path SHALL write a service-delivered rule into the engine directory its payload identifies. The current API carries **no** engine discriminator — `/cli/api/rule/{ruleId}` returns `rules[].content` documented as an ast-grep rule definition — so a payload that does not identify an engine SHALL be written as ast-grep, under `.taskless/sg/rules/<id>.yml`, with its tests under `.taskless/sg/rule-tests/`.

This default is permanent, not a migration window: published CLIs and stored payloads without an engine field continue to exist indefinitely, and the default matches what the migration does to the same rules already on disk.

Absence of an engine and an **unrecognized** engine are distinct. If a payload identifies an engine the installed CLI does not know, ingest SHALL fail with an error naming the engine and instructing the user to upgrade, and SHALL NOT fall back to ast-grep.

#### Scenario: Engine-less payload is filed under sg

- **WHEN** a rule is delivered by the service with no engine identified in its payload
- **THEN** it is written to `.taskless/sg/rules/<id>.yml` and its tests to `.taskless/sg/rule-tests/`, and a subsequent `check` dispatches it to ast-grep

#### Scenario: Ingest and migration agree on destination

- **WHEN** a rule that predates the engine-partitioned layout is migrated, and an equivalent rule is delivered fresh by the service
- **THEN** both come to rest at the same path under `.taskless/sg/rules/`

#### Scenario: Unrecognized engine fails loudly

- **WHEN** a payload identifies an engine the installed CLI does not support
- **THEN** ingest exits with an error naming the engine and directing the user to upgrade, and no rule file is written under any engine directory

### Requirement: Reconciliation survives the relayout

The CLI SHALL report rule files to the reconcile endpoint at their post-migration repo-relative paths. Because the server joins reported files by content signature rather than by path, moving a rule without editing it SHALL NOT change its reconciled state.

#### Scenario: Moved rules reconcile unchanged

- **WHEN** `check` reconciles after the migration has moved rules from `.taskless/rules/` to `.taskless/sg/rules/` and runtime rules to `.taskless/runtime/rules/`
- **THEN** each file's signature is unchanged, the server resolves it to the same rule, and no rule is reported as new or missing

### Requirement: The CLI refuses a scaffold newer than it understands unless overridden

When `taskless.json`'s `version` exceeds the highest migration the installed CLI knows, the system SHALL exit with an error instructing the user to upgrade the CLI, unless `--allow-version-mismatches` is passed, in which case it SHALL proceed without applying migrations.

#### Scenario: Newer scaffold blocks

- **WHEN** `taskless.json` has a `version` greater than the CLI's maximum known migration
- **THEN** the CLI exits with an error telling the user to upgrade the CLI

#### Scenario: Override proceeds

- **WHEN** the same condition holds and `--allow-version-mismatches` is set
- **THEN** the CLI proceeds without applying migrations

### Requirement: Rules are one directory each, partitioned by engine

The system SHALL store every rule as a directory at `.taskless/rules/<engine>/<id>/`, holding the rule, any config that engine requires, and its tests under `.tests/`.

| Engine    | Rule directory contents                                      |
|-----------|--------------------------------------------------------------|
| `sg`      | `<id>.yml`, `.tests/<id>-YYYYMMDD-test.yml`                  |
| `vale`    | `<id>.yml`, `.vale.ini`, `.tests/pass/*`, `.tests/fail/*`    |
| `runtime` | `check.ts`, `captures/*.yml`, `.tests/…`                     |

One directory per rule is what lets a rule be addressed, reviewed, moved, or deleted as a single thing, and it is what makes `verify <path>` and `test <path>` possible without an id lookup.

Tests SHALL live in `.tests/`, dot-prefixed. This is not cosmetic: ast-grep's `ruleDirs` recurses and parses every `.yml` beneath it as a rule, so a plain `tests/` directory inside a rule directory fails the scan outright. Measured against ast-grep 0.41.0, a dot-directory is skipped by rule discovery while `sg test` still reads it when `testDir` names it.

#### Scenario: A rule is one path

- **WHEN** a rule is authored for any engine
- **THEN** everything defining it lives under one `.taskless/rules/<engine>/<id>/` directory
- **AND** removing that directory removes the rule completely

#### Scenario: Test files are not mistaken for rules

- **WHEN** an ast-grep rule directory contains `.tests/` with test YAML in it
- **THEN** a scan SHALL complete without attempting to parse those files as rules

#### Scenario: The engine is read from the path

- **WHEN** the system needs a rule's engine
- **THEN** it reads the `<engine>` path segment
- **AND** it SHALL NOT parse the rule file to determine it

### Requirement: Each engine's native config is the source of truth

The system SHALL treat each engine's native config as the authoritative definition of its rules, their scoping, and their metadata, and SHALL NOT require a separate Taskless sidecar or metadata file for a rule.

Where an engine's configuration is per-rule, that per-rule file is the committed source of truth. Where the engine requires a single file at invocation — Vale accepts one `--config`, ast-grep one `sgconfig.yml` — the system SHALL assemble that file from the committed per-rule sources and SHALL gitignore the result. An assembled config is the engine's own native config, split along the boundary the engine's own scoping already has; it is not a Taskless sidecar.

An engine SHALL NOT be given a per-rule config file it has nothing to put in. ast-grep expresses scoping (`files`, `ignores`) inside the rule itself, so it has no per-rule config; Vale cannot express scoping inside the style — measured, `E201 has invalid keys` — so it does.

#### Scenario: Vale config is assembled from committed per-rule configs

- **WHEN** the CLI runs a check
- **THEN** it reads each committed `rules/vale/<id>/.vale.ini` and assembles the config it hands to Vale
- **AND** the assembled file SHALL be gitignored

#### Scenario: ast-grep config is assembled from the rule tree

- **WHEN** the CLI runs a check or a test
- **THEN** it assembles `sgconfig.yml` with `ruleDirs` covering the rules tree and `testConfigs` covering each rule's `.tests/`
- **AND** the assembled file SHALL be gitignored

#### Scenario: No empty per-rule config is required

- **WHEN** an ast-grep rule is authored
- **THEN** no per-rule config file SHALL be required alongside it

#### Scenario: Native scoping is applied by the engine

- **WHEN** an ast-grep rule declares native `files`/`ignores`, or a Vale rule's config declares include/exclude matchers
- **THEN** the engine applies that scoping directly, with no Taskless-side rule transformation

### Requirement: Vale styles live under a per-rule StyleName

The system SHALL place each Vale rule in its own directory `.taskless/rules/vale/<id>/`, so that `<id>` is Vale's StyleName, with the assembled config setting `StylesPath` to the Vale rules tree. The Vale check identifier `<id>.<id>` SHALL be normalized to `ruleId = <id>` in results.

`StylesPath` follows the layout and cannot be chosen independently of it. Measured against Vale 3.17.1: a rule at `<id>/<id>.yml` resolves as check `<id>.<id>` under a StylesPath naming its parent, and resolves to nothing at all under `StylesPath = .`. The reverse held for the previous flat layout — the same setting is correct for one layout and silently wrong for the other.

#### Scenario: Style resolution and identity

- **WHEN** a Vale style exists at `.taskless/rules/vale/no-simply/no-simply.yml`
- **THEN** Vale loads it as `no-simply.no-simply`, and the CLI reports its findings with `ruleId` `no-simply`

#### Scenario: A rule's tests are not loaded as styles

- **WHEN** a Vale rule directory contains `.tests/`
- **THEN** Vale SHALL NOT load anything under it as a rule

### Requirement: Runtime capture rules live in captures

A runtime rule's ast-grep capture rules SHALL live in `captures/` inside the rule directory, and `check.ts` SHALL remain at the rule directory's root.

The name is deliberate. "Matcher" denotes a Vale `[<glob>]` config section elsewhere in this system, and one word for two unrelated concepts in one tree is a cost paid at every future reading.

#### Scenario: Capture rules are found in captures

- **WHEN** the system discovers a runtime rule
- **THEN** it reads its capture rules from `captures/`
- **AND** it reads `check.ts` from the rule directory root

### Requirement: A rule's canonical location is what verify and test address

Each engine SHALL have one canonical on-disk location per rule — the rule directory — and that location SHALL be what `verify` and `test` accept as a path. A directory above it SHALL mean every rule beneath.

#### Scenario: One address per rule

- **WHEN** `verify` or `test` is given `.taskless/rules/<engine>/<id>/`
- **THEN** it operates on exactly that rule
- **AND** the engine is determined from the path without reading the rule

