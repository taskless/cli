# cli-rule-format Specification

## Purpose

The on-disk shape of a rule: one directory per rule, partitioned by engine, with each engine's native config as the source of truth.

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

### Requirement: Reconciliation survives the relayout

The CLI SHALL report each rule to the reconcile endpoint by its `ruleId` (the rule's directory
name) with file paths relative to the rule's own directory, so where the engine-partitioned
layout places a rule's directory is not part of what is reported. Moving a rule directory
without renaming or editing it SHALL NOT change its reconciled state.

#### Scenario: Moved rules reconcile unchanged

- **WHEN** `check` reconciles after the migration has moved rules into `.taskless/rules/<engine>/<id>/`
- **THEN** each rule is reported under the same `ruleId` with the same relative paths and signatures, the server resolves it to the same rule, and no rule is reported as new or missing

### Requirement: The CLI refuses a scaffold newer than it understands unless overridden

When `taskless.json`'s `version` exceeds the highest migration the installed CLI knows, the system SHALL exit with an error instructing the user to upgrade the CLI, unless `--allow-version-mismatches` is passed, in which case it SHALL proceed without applying migrations.

#### Scenario: Newer scaffold blocks

- **WHEN** `taskless.json` has a `version` greater than the CLI's maximum known migration
- **THEN** the CLI exits with an error telling the user to upgrade the CLI

#### Scenario: Override proceeds

- **WHEN** the same condition holds and `--allow-version-mismatches` is set
- **THEN** the CLI proceeds without applying migrations

### Requirement: Rules are one directory each, partitioned by engine

The system SHALL store every rule as a directory at `.taskless/rules/<engine>/<id>/`, holding the rule, any config that engine requires, and its tests under `tests/`.

| Engine    | Rule directory contents                                                    |
| --------- | -------------------------------------------------------------------------- |
| `sg`      | `<id>.yml`, `tests/pass/<case>/…`, `tests/fail/<case>/…`                   |
| `vale`    | `<id>.yml`, `.vale.ini`, `tests/pass/<case>/…`, `tests/fail/<case>/…`      |
| `runtime` | `check.ts`, `captures/*.yml`, `tests/pass/<case>/…`, `tests/fail/<case>/…` |

One directory per rule is what lets a rule be addressed, reviewed, moved, or deleted as a single thing, and it is what makes `verify <path>` and `test <path>` possible without an id lookup.

Tests SHALL live in `tests/`, with no dot prefix, laid out as `cli-rule-fixtures` describes. The previous dot prefix worked around ast-grep's rule discovery: `ruleDirs` recurses and parses every `.yml` beneath it as a rule, and a plain `tests/` inside a rule directory fails the whole scan. Re-measured on 0.51.0, that is still true. So the engine is never pointed at the committed rules tree. It reads its rules from a rules-only tree the CLI assembles (see "Each engine's native config is the source of truth"), and what a rule directory may contain stops depending on undocumented engine behavior. A visible `tests/` is also where an author or an agent looks first. A dot directory is hidden in most listings, and fixtures written beside it were common enough to need a migration of their own (`0010`).

#### Scenario: A rule is one path

- **WHEN** a rule is authored for any engine
- **THEN** everything defining it lives under one `.taskless/rules/<engine>/<id>/` directory
- **AND** removing that directory removes the rule completely

#### Scenario: Test files are not mistaken for rules

- **WHEN** an ast-grep rule directory contains `tests/` with `.yml` fixture files in it
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

- **WHEN** the CLI runs a check or verifies a rule
- **THEN** it assembles a rules-only tree holding each selected rule's `<id>.yml` and nothing else from its directory
- **AND** it assembles `sgconfig.yml` with `ruleDirs` naming that tree
- **AND** both SHALL live in the run directory or be gitignored, and SHALL NOT be written under `.taskless/rules/`

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

- **WHEN** a Vale rule directory contains `tests/`
- **THEN** Vale SHALL NOT load anything under it as a rule

### Requirement: Runtime capture rules live in captures

A runtime rule's ast-grep capture rules SHALL live in `captures/` inside the rule directory, and `check.ts` SHALL remain at the rule directory's root.

The name is deliberate. "Matcher" denotes a Vale `[<glob>]` config section elsewhere in this system, and one word for two unrelated concepts in one tree is a cost paid at every future reading.

#### Scenario: Capture rules are found in captures

- **WHEN** the system discovers a runtime rule
- **THEN** it reads its capture rules from `captures/`
- **AND** it reads `check.ts` from the rule directory root

### Requirement: A rule's canonical location is what validate and verify address

Each engine SHALL have one canonical on-disk location per rule — the rule directory — and that location SHALL be what `validate` and `verify` accept as a path. A directory above it SHALL mean every rule beneath.

#### Scenario: One address per rule

- **WHEN** `validate` or `verify` is given `.taskless/rules/<engine>/<id>/`
- **THEN** it operates on exactly that rule
- **AND** the engine is determined from the path without reading the rule

### Requirement: A served rule is filed under the engine it names

The CLI SHALL write a rule served by the v2 API into `.taskless/rules/<engine>/<id>/`, where
`<engine>` is the file set's own `engine`, which v2 always sends. If the set names an engine
the installed CLI does not know, the CLI SHALL refuse it with an error naming the engine and
directing the user to upgrade, SHALL write nothing under any engine directory, and SHALL NOT
fall back to ast-grep.

#### Scenario: A served rule lands under its engine

- **WHEN** a served file set declares engine `vale`
- **THEN** it is written under `.taskless/rules/vale/<id>/`

#### Scenario: An unrecognized engine fails loudly

- **WHEN** a served file set declares an engine the installed CLI does not support
- **THEN** the CLI exits with an error naming the engine and directing the user to upgrade, and no rule file is written under any engine directory
