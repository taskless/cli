# cli-rule-format Specification

## Purpose

TBD - created by archiving change partition-rules-by-engine. Update Purpose after archive.

## Requirements

### Requirement: Rules are partitioned into per-engine directories

The system SHALL store rules under a top-level engine directory `.taskless/<engine>/`, each with a `rules/` directory and a `rule-tests/` directory. The `sg` engine SHALL use `sgconfig.yml`; the `vale` engine SHALL use `.vale.ini`; the `runtime` engine SHALL store each rule as a directory `rules/<rule>/` (capture `*.yml` + `check.ts`) with fixtures under `rule-tests/<rule>/`.

#### Scenario: ast-grep engine directory

- **WHEN** the CLI resolves `.taskless/`
- **THEN** ast-grep rules are found under `.taskless/sg/rules/`, the config is `.taskless/sg/sgconfig.yml`, and tests are under `.taskless/sg/rule-tests/`

#### Scenario: Vale engine directory

- **WHEN** the CLI resolves `.taskless/`
- **THEN** Vale styles are found under `.taskless/vale/rules/`, the config is `.taskless/vale/.vale.ini`, and tests are under `.taskless/vale/rule-tests/`

### Requirement: A rule's engine is determined by its containing directory

The system SHALL dispatch each rule to the engine named by its top-level `.taskless/<engine>/` directory, and SHALL NOT parse a rule file to determine its engine.

#### Scenario: Directory-based dispatch

- **WHEN** a rule file exists at `.taskless/sg/rules/no-eval.yml` and another at `.taskless/vale/rules/no-simply.yml`
- **THEN** the first is executed by ast-grep and the second by Vale, based solely on directory

### Requirement: Each engine's committed native config is the source of truth

The system SHALL treat each engine's committed native config as the authoritative definition of its rules, their scoping, and their metadata. The system SHALL NOT require a separate Taskless sidecar or metadata file for a rule, and SHALL NOT generate an engine config at check time.

#### Scenario: No sidecar or generated config

- **WHEN** the CLI runs a check
- **THEN** it reads the committed `sg/sgconfig.yml` and `vale/.vale.ini` as-is, and neither writes nor generates an engine config

#### Scenario: Native scoping is applied by the engine

- **WHEN** an ast-grep rule declares native `files`/`ignores`, or a Vale `.vale.ini` declares per-rule include/exclude sections
- **THEN** the engine applies that scoping directly, with no Taskless-side rule transformation

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

### Requirement: Both the legacy and engine-partitioned layouts are readable

The CLI SHALL dispatch rules found at the legacy `.taskless/rules/` path as ast-grep, in addition to `.taskless/sg/rules/`, so a checkout that has not yet been migrated — or a rule delivered by a service that still names the legacy location — is executed rather than ignored.

This tolerance is what decouples the CLI's release from any consumer's: a producer may continue to use the pre-migration layout indefinitely and its rules keep running.

#### Scenario: Unmigrated checkout still runs its rules

- **WHEN** `check` runs against a `.taskless/` containing `rules/` but no `sg/`
- **THEN** those rules are dispatched to ast-grep and reported, not silently skipped

#### Scenario: Both layouts present

- **WHEN** rules exist under both `.taskless/rules/` and `.taskless/sg/rules/`
- **THEN** both are dispatched to ast-grep and their findings merged, with no duplicate reporting of the same rule

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

### Requirement: Vale styles live under the rules StyleName

The system SHALL place Vale styles under `.taskless/vale/rules/` so that `rules` is Vale's StyleName, with `.vale.ini` configured `StylesPath = .` and `BasedOnStyles = rules`. The Vale check identifier `rules.<name>` SHALL be normalized to `ruleId = <name>` in results.

#### Scenario: Style resolution and identity

- **WHEN** a Vale style exists at `.taskless/vale/rules/no-simply.yml`
- **THEN** Vale loads it as `rules.no-simply`, and the CLI reports its findings with `ruleId` `no-simply`
