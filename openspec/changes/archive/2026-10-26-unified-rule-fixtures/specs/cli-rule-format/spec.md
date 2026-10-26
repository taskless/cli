## MODIFIED Requirements

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
