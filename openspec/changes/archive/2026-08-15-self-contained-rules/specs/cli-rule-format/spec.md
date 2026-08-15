## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Rules are partitioned into per-engine directories

**Reason**: Superseded by "Rules are one directory each, partitioned by engine". The old requirement placed a rule as a bare file under an engine directory; a rule is now a directory holding its own file, config, and tests.

### Requirement: Each engine's committed native config is the source of truth

**Reason**: Superseded by "Each engine's native config is the source of truth". The committed per-engine config is gone: configs are per-rule and the file each tool reads is assembled per run and gitignored.

### Requirement: Vale styles live under the rules StyleName

**Reason**: Superseded by "Vale styles live under a per-rule StyleName". `StylesPath` now points at the Vale rules tree, so each rule directory is its own style and a rule resolves as `<id>.<id>` rather than `rules.<id>`.

### Requirement: Both the legacy and engine-partitioned layouts are readable

**Reason**: This change deletes the legacy read paths. Migrations run before any read, so an unmigrated tree cannot reach dispatch, and the legacy constant now names the same string as the new rules root — a stale read path resolving into the live tree is worse than none (design D9).
