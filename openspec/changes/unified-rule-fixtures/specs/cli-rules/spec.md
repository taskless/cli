## MODIFIED Requirements

### Requirement: Rules create writes test files to disk

`taskless rule create` SHALL write generated test files into the rule's own directory, at `.taskless/rules/sg/<id>/tests/`, regardless of whether `--anonymous` was set. (Renamed; strengthened; repathed for the rule-directory layout.)

#### Scenario: Tests land inside the rule they cover

- **WHEN** `taskless rule create` generates test cases for rule `<id>`
- **THEN** the CLI SHALL write them under `.taskless/rules/sg/<id>/tests/`
- **AND** it SHALL do so whether or not `--anonymous` was set

### Requirement: Rules delete removes rule and test files

`taskless rule delete <id>` SHALL remove the rule and everything that defines it. Under the rule-directory layout that is one directory, `.taskless/rules/<engine>/<id>/`, which carries the rule, any per-engine config, and its tests. (Renamed; repathed.) Accepts `--anonymous` as a no-op.

A rule id does not carry its engine, so the CLI SHALL **resolve** which engine directory holds `<id>` rather than assuming one. A rule id is globally unique by construction, so at most one engine can hold it. When no engine holds the id, the CLI SHALL report not-found without naming an engine, because naming one would be a guess.

#### Scenario: Deleting a rule removes its whole directory

- **WHEN** a user runs `taskless rule delete no-eval`
- **THEN** the CLI SHALL remove the rule's directory including its `tests/`
- **AND** no file belonging to that rule SHALL remain

#### Scenario: Deleting a rule filed under any engine

- **WHEN** a rule with id `<id>` exists under `.taskless/rules/vale/<id>/` or `.taskless/rules/runtime/<id>/`
- **THEN** `taskless rule delete <id>` SHALL remove that directory
- **AND** SHALL NOT report not-found for a rule that is present on disk

#### Scenario: Deleting an id no engine holds

- **WHEN** no engine directory contains `<id>`
- **THEN** the CLI SHALL report the rule was not found under `.taskless/rules/`
- **AND** the message SHALL NOT name a single engine's path

### Requirement: Rule create supports anonymous local-only flow

When `taskless rule create --anonymous` is invoked, the CLI SHALL execute the local-only rule-creation flow (previously implemented as the `taskless-create-rule-anonymous` skill body). The flow SHALL:

1. NOT submit any request to the Taskless API
2. Generate the ast-grep rule using local logic (Claude SDK, agent-driven generation, or whatever the migrated implementation prefers — see design.md)
3. Write the rule file to `.taskless/rules/sg/<id>/<id>.yml`
4. Write any generated test files into that rule's own directory, under `.taskless/rules/sg/<id>/tests/`
5. NOT write a metadata sidecar (neither does the API-backed branch: the
   service never populates the `meta` block a sidecar would be written from,
   so no branch of `rule create` has ever written one)
6. Return the same output format as the API-backed branch (paths to created files)

#### Scenario: rule create --anonymous skips API

- **WHEN** a user runs `taskless rule create --from req.json --anonymous`
- **THEN** the CLI SHALL NOT make any HTTP request to the Taskless API
- **AND** SHALL produce a rule file under `.taskless/rules/`

#### Scenario: rule create --anonymous produces no metadata sidecar

- **WHEN** `taskless rule create --anonymous` succeeds
- **THEN** no file under `.taskless/rule-metadata/` SHALL be written for the new rule
