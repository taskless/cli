## MODIFIED Requirements

### Requirement: Each engine's native config is the source of truth

The system SHALL treat each engine's native config as the authoritative definition of its rules, their scoping, and their metadata, and SHALL NOT require a separate Taskless sidecar or metadata file for a rule.

Where that config is **committed**, the system SHALL read it as-is and SHALL NOT generate it at check time. `sg/sgconfig.yml` is committed and read as-is.

Vale is the exception, and deliberately. Its scoping is per-rule but its config is per-run: Vale accepts exactly one `--config`, so a project's rules have to reach a single file before Vale can be invoked. The committed source of truth is therefore each rule's own `.vale.ini`, and the file handed to Vale is assembled from them. This is not a Taskless sidecar — it is the engine's own native config, split along the boundary the engine's scoping already has.

#### Scenario: ast-grep config is read as committed

- **WHEN** the CLI runs a check
- **THEN** it reads the committed `sg/sgconfig.yml` as-is, and neither writes nor generates it

#### Scenario: Vale config is assembled from committed per-rule configs

- **WHEN** the CLI runs a check
- **THEN** it reads each committed `vale/rules/<id>/.vale.ini` and assembles the config it hands to Vale
- **AND** the assembled file SHALL be gitignored

#### Scenario: Native scoping is applied by the engine

- **WHEN** an ast-grep rule declares native `files`/`ignores`, or a Vale rule's config declares include/exclude matchers
- **THEN** the engine applies that scoping directly, with no Taskless-side rule transformation

### Requirement: Vale styles live under a per-rule StyleName

The system SHALL place each Vale rule in its own directory `.taskless/vale/rules/<id>/`, so that `<id>` is Vale's StyleName, with the assembled config setting `StylesPath = rules`. The Vale check identifier `<id>.<id>` SHALL be normalized to `ruleId = <id>` in results.

`StylesPath` follows the layout and cannot be chosen independently of it. Measured against Vale 3.17.1: a rule at `rules/<id>/<id>.yml` resolves as check `<id>.<id>` under `StylesPath = rules`, and resolves to nothing at all under `StylesPath = .`. The reverse held for the previous flat layout, where `StylesPath = .` made `rules` the StyleName and `StylesPath = rules` resolved nothing — the same setting is correct for one layout and silently wrong for the other.

#### Scenario: Style resolution and identity

- **WHEN** a Vale style exists at `.taskless/vale/rules/no-simply/no-simply.yml`
- **THEN** Vale loads it as `no-simply.no-simply`, and the CLI reports its findings with `ruleId` `no-simply`

#### Scenario: The rule-tests tree is outside StylesPath

- **WHEN** `StylesPath` is `rules`
- **THEN** `.taskless/vale/rule-tests/` SHALL NOT be loaded as a style directory

## ADDED Requirements

### Requirement: A rule's canonical location is what verify and test address

Each engine SHALL have one canonical on-disk location per rule, and that location SHALL be what `verify` and `test` accept as a path.

| Engine    | Canonical location                        | Shape     |
|-----------|-------------------------------------------|-----------|
| `sg`      | `.taskless/sg/rules/<id>.yml`             | file      |
| `vale`    | `.taskless/vale/rules/<id>/`              | directory |
| `runtime` | `.taskless/runtime/rules/<name>/`         | directory |

A rule's engine SHALL be resolved from where its path sits, never from its contents, which is the rule the check dispatcher already follows.

#### Scenario: Each engine has one canonical rule location

- **WHEN** a rule is authored for any engine
- **THEN** it is written at that engine's canonical location
- **AND** a command given that path can determine the engine without reading the file
