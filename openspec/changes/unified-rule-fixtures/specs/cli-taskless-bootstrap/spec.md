## ADDED Requirements

### Requirement: Migration 12 moves every rule's fixtures into tests case directories

Migration `12` SHALL convert each rule's fixtures from `.tests/` to the `tests/pass/<case>/` and `tests/fail/<case>/` layout, for every engine:

| Engine    | From                                                                | To                                                                                        |
| --------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `sg`      | each `valid:` / `invalid:` snippet of each `.tests/*.yml` test file | one case per snippet under `tests/pass/` / `tests/fail/`, holding the snippet as one file |
| `vale`    | each document `.tests/<bucket>/<name>`                              | `tests/<bucket>/<stem>/<path>`                                                            |
| `runtime` | `.tests/<bucket>/<case>/…`                                          | `tests/<bucket>/<case>/…`, unchanged                                                      |

An ast-grep snippet's file extension SHALL come from a fixed table keyed on the rule's `language:`, covering every language the vendored ast-grep supports. A converted file's path within its case SHALL be one the rule's scope accepts (`files:` and `ignores:` for ast-grep, the enabling matchers for Vale), derived from the scope's own patterns and checked against them. Where the scope offers more than one path, one keeping the file's own extension SHALL be preferred, since both engines choose how to read a file by its extension. A converted case SHALL be named by bucket and ordinal in source order, since a snippet carries no description to name it by. Ordinals SHALL continue across all of a rule's test files, read in name order, and two Vale documents sharing a stem SHALL get distinct case names, so no converted case lands on another.

The migration SHALL NOT delete what it did not convert. A test file it cannot parse, a snippet whose language has no table entry, or a scope it cannot derive an accepted path from SHALL be left in place under `.tests/`. The migration SHALL name each one, and SHALL remove `.tests/` only once it is empty. A destination that already exists SHALL keep its bytes. A source SHALL be removed only once every file it produced is on disk: a destination already holding the same bytes counts, and one holding other bytes SHALL leave the source in place and named. The migration SHALL be idempotent.

It SHALL NOT modify any shipped migration. Migrations `5`, `9` and `10` still move fixtures into `.tests/`, and `12` then moves them on, so a fresh scaffold and an old one end in the same state by running `1` through `12` in order.

**Rationale.** A layout is what the scaffold version records, so this is a scaffold migration and not a rule-content migration. Fixtures carry no signature, so moving or rewriting them changes no signed byte, and the migration is as safe for an issued rule as for a hand-written one. Deriving a path the scope accepts is what keeps a converted fixture meaningful once scope applies. A snippet that used to pass only because stdin bypassed `files:` would otherwise become a quiet `fail/` case the moment it was migrated.

#### Scenario: ast-grep snippets become case directories

- **WHEN** `taskless.json` records version 11 and `.taskless/rules/sg/no-eval/.tests/no-eval-test.yml` holds two `valid:` and one `invalid:` snippet for a `language: TypeScript` rule
- **THEN** migration 12 SHALL run
- **AND** `tests/pass/` SHALL hold two cases and `tests/fail/` one, each with one `.ts` file holding its snippet
- **AND** `.tests/` SHALL NOT exist afterwards
- **AND** `taskless.json` SHALL record version 12

#### Scenario: A rule with several test files keeps every snippet

- **WHEN** an ast-grep rule's `.tests/` holds `no-eval-20260101-test.yml` and `no-eval-20260301-test.yml`, each with one `invalid:` snippet
- **THEN** `tests/fail/` SHALL hold `fail-01` with the first file's snippet and `fail-02` with the second's
- **AND** both test files SHALL be gone

#### Scenario: A destination holding other bytes keeps its source

- **WHEN** a snippet converts to a path that already holds different content
- **THEN** that content SHALL be unchanged
- **AND** the test file SHALL remain under `.tests/`
- **AND** the migration SHALL name the path

#### Scenario: A scoped rule's converted fixture sits where its scope looks

- **WHEN** an ast-grep rule declares `files: [".github/workflows/*.yml"]` and its test YAML holds an `invalid:` snippet
- **THEN** the converted case SHALL hold that snippet at a path matching `.github/workflows/*.yml`

#### Scenario: What cannot be converted stays and is named

- **WHEN** a rule's scope admits no path the migration can derive and check
- **THEN** that rule's fixtures SHALL remain under `.tests/`
- **AND** the migration SHALL name the rule and why
- **AND** every other rule SHALL still be migrated

#### Scenario: Runtime cases are renamed only

- **WHEN** a runtime rule holds `.tests/fail/two-files/a.ts` and `.tests/fail/two-files/b.ts`
- **THEN** after migration 12 they SHALL be at `tests/fail/two-files/a.ts` and `tests/fail/two-files/b.ts` with identical bytes

#### Scenario: Migration 12 is idempotent

- **WHEN** migration 12 runs on a project it has already migrated
- **THEN** no file SHALL change
