## ADDED Requirements

### Requirement: Migration 9 renames a rule id held by more than one engine

Migration `9` SHALL read `.taskless/rules/` and, for every rule id that is a directory name under more than one engine, SHALL rename EVERY holding copy to `<id>-<engine>`. No engine SHALL keep the bare id. Any precedence rule would be arbitrary, and a symmetric rename means no user has to work out which of their two rules silently kept the name.

It SHALL rename rather than refuse. A throwing migration walls `init`, which is the command `SCAFFOLD_MIGRATION_REQUIRED` sends a stale scaffold to, so a refusal leaves the CLI's own instruction failing and a multi-file hand edit as the only way out.

The rename SHALL carry every reference to the id inside the rule's own directory, and SHALL reach nothing outside it:

| Engine    | What the rename SHALL move                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| `sg`      | the directory, `<id>.yml`, its `id:` field, every `.tests/<id>-*-test.yml`, and each fixture's own `id:` field  |
| `vale`    | the directory, `<id>.yml`, and in `.vale.ini` both the `tskl) rule` breadcrumb and both segments of `<id>.<id>` |
| `runtime` | the directory only                                                                                              |

Both Vale segments move because `StylesPath` points at `rules/vale`, so the rule directory is the style and `<id>.yml` is the check inside it. A runtime rule carries the id in its directory alone: `check.ts` is a fixed name, and a capture file's `id:` and `metadata.taskless.name` identify the capture rather than the rule.

It SHALL NOT clobber. When `<id>-<engine>` is already in use the migration SHALL take the first free `<id>-<engine>-N` counting from 2, and a name SHALL count as free only when NO engine holds it, so resolving one collision cannot create another. Every name it chooses SHALL satisfy the rule id contract.

It SHALL NOT move or delete `.taskless/rule-metadata/<id>.yml`. The rename is symmetric, so the sidecar has no owner to follow and moving it to either side would be a guess.

It SHALL print every rename: the old path, the new path, and each file rewritten inside it. A migration that silently renames a user's rules is worse than one that refuses.

It SHALL write nothing when there is no collision. A project in that state SHALL be read and left exactly as it is, so a second run touches nothing and the working tree stays clean. A project with no `rules/` tree SHALL be left as it is.

#### Scenario: Every colliding copy is renamed symmetrically

- **WHEN** `no-eval` exists under both `sg` and `vale` and migration 9 runs
- **THEN** `rules/sg/no-eval` SHALL become `rules/sg/no-eval-sg`
- **AND** `rules/vale/no-eval` SHALL become `rules/vale/no-eval-vale`
- **AND** no engine SHALL still hold the bare id

#### Scenario: An sg rule's file, id field and fixtures follow it

- **WHEN** migration 9 renames a colliding `sg` rule
- **THEN** `<old>.yml` SHALL become `<new>.yml` with its `id:` field rewritten
- **AND** every `.tests/<old>-*-test.yml` SHALL be renamed to the new prefix with its own `id:` field rewritten

#### Scenario: A Vale rule's style file and both config segments follow it

- **WHEN** migration 9 renames a colliding `vale` rule
- **THEN** `<old>.yml` SHALL become `<new>.yml`
- **AND** the `.vale.ini` breadcrumb SHALL name the new id
- **AND** the `<old>.<old>` assignment SHALL become `<new>.<new>`

#### Scenario: A runtime rule is renamed by directory alone

- **WHEN** migration 9 renames a colliding `runtime` rule
- **THEN** the directory SHALL be renamed
- **AND** `check.ts` and the capture files SHALL be left as they are

#### Scenario: A taken target name takes the next free suffix

- **WHEN** `<id>-<engine>` is already held by some engine
- **THEN** the migration SHALL rename to the first free `<id>-<engine>-N` counting from 2
- **AND** the existing rule of that name SHALL NOT be modified

#### Scenario: The metadata sidecar is left in place

- **WHEN** `.taskless/rule-metadata/<id>.yml` exists for a colliding id and migration 9 runs
- **THEN** the sidecar SHALL be left exactly as it is
- **AND** the report SHALL say it was left behind

#### Scenario: Every rename is reported

- **WHEN** migration 9 renames anything
- **THEN** it SHALL print each old path, each new path, and each file it rewrote

#### Scenario: The renamed project verifies and checks clean

- **WHEN** migration 9 has renamed a colliding project
- **THEN** `verify` SHALL report no collision
- **AND** each renamed rule SHALL still run and report findings under its new id

#### Scenario: Migration 9 is idempotent

- **WHEN** migration 9 runs a second time over a project it has already renamed, or over one with no collision
- **THEN** it SHALL write nothing

#### Scenario: A project with no rules tree is left alone

- **WHEN** `.taskless/rules/` does not exist and migration 9 runs
- **THEN** the migration SHALL succeed and write nothing
