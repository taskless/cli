## ADDED Requirements

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

### Requirement: Vale styles live under the rules StyleName

The system SHALL place Vale styles under `.taskless/vale/rules/` so that `rules` is Vale's StyleName, with `.vale.ini` configured `StylesPath = .` and `BasedOnStyles = rules`. The Vale check identifier `rules.<name>` SHALL be normalized to `ruleId = <name>` in results.

#### Scenario: Style resolution and identity

- **WHEN** a Vale style exists at `.taskless/vale/rules/no-simply.yml`
- **THEN** Vale loads it as `rules.no-simply`, and the CLI reports its findings with `ruleId` `no-simply`

### Requirement: Migration preserves existing ast-grep rules by moving them under sg

The migration to the engine-partitioned layout SHALL move the existing `.taskless/rules/`, `.taskless/rule-tests/`, and `.taskless/sgconfig.yml` under `.taskless/sg/` without editing file contents, relying on `sgconfig.yml`'s relative `ruleDirs: [rules]` remaining valid after the move. It SHALL scaffold `.taskless/vale/` and SHALL move `.taskless/runtime-rules/` to `.taskless/runtime/rules/` and `.taskless/runtime-rule-tests/` to `.taskless/runtime/rule-tests/` without editing file contents (preserving runtime capture-rule hashes). Every scaffolded directory that would otherwise be empty SHALL contain a `.gitkeep` file so the structure is tracked reliably.

#### Scenario: Mechanical move of legacy rules

- **WHEN** the migration runs against a `.taskless/` containing `rules/`, `rule-tests/`, and `sgconfig.yml`
- **THEN** those become `sg/rules/`, `sg/rule-tests/`, and `sg/sgconfig.yml`, and `sg scan --config .taskless/sg/sgconfig.yml` runs the same rules as before the move

#### Scenario: Vale scaffolded, runtime moved

- **WHEN** the migration runs
- **THEN** `.taskless/vale/` is created with empty `rules/` and `rule-tests/`, and `.taskless/runtime-rules/` becomes `.taskless/runtime/rules/` with byte-identical contents

### Requirement: The CLI refuses a scaffold newer than it understands unless overridden

When `taskless.json`'s `version` exceeds the highest migration the installed CLI knows, the system SHALL exit with an error instructing the user to upgrade the CLI, unless `--allow-version-mismatches` is passed, in which case it SHALL proceed without applying migrations.

#### Scenario: Newer scaffold blocks

- **WHEN** `taskless.json` has a `version` greater than the CLI's maximum known migration
- **THEN** the CLI exits with an error telling the user to upgrade the CLI

#### Scenario: Override proceeds

- **WHEN** the same condition holds and `--allow-version-mismatches` is set
- **THEN** the CLI proceeds without applying migrations
