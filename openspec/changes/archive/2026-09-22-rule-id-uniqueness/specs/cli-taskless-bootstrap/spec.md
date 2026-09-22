## ADDED Requirements

### Requirement: Migration 9 refuses a project whose rule id is held by more than one engine

Migration `9` SHALL read `.taskless/rules/` and SHALL refuse the migration when any rule id is a directory name under more than one engine, naming every directory holding the id and the `.taskless/rule-metadata/<id>.yml` sidecar they share. It SHALL report the same error code `rules delete` reports for the same condition, `RULE_ID_AMBIGUOUS`.

It SHALL NOT rename anything. Nothing available to a migration can tell which of the two rules should keep the id, and a rename is not local: the sidecar, the rule's `.tests/` fixtures and the server-side id all reference the old name, so an automatic rename would pick one at random and break the references of whichever it moved.

The refusal SHALL state the rename to perform BEFORE `init` is re-run. `check` and `verify` refuse a scaffold behind the current version with `SCAFFOLD_MIGRATION_REQUIRED`, which names `init`, and `init` is what runs migrations; a refusal that only reported the collision would return the user to `init` and be refused again.

The migration SHALL write nothing in any case. A project with no collision SHALL be read and left exactly as it is, so a second run touches nothing and the working tree stays clean. A project with no `rules/` tree SHALL be left as it is.

#### Scenario: A colliding project is refused by name

- **WHEN** `no-eval` exists under two engines and migration 9 runs
- **THEN** the migration SHALL throw
- **AND** the message SHALL name both rule directories and the shared metadata sidecar
- **AND** the error code SHALL be `RULE_ID_AMBIGUOUS`

#### Scenario: The refusal names the rename to perform before init

- **WHEN** migration 9 refuses a colliding project
- **THEN** the message SHALL say to rename one of the directories before re-running `init`
- **AND** it SHALL say that nothing is renamed automatically

#### Scenario: Nothing is renamed

- **WHEN** migration 9 refuses a colliding project
- **THEN** both rule directories SHALL remain where they were

#### Scenario: Migration 9 is idempotent

- **WHEN** migration 9 runs twice over a project with no collision
- **THEN** neither run SHALL write anything

#### Scenario: A project with no rules tree is left alone

- **WHEN** `.taskless/rules/` does not exist and migration 9 runs
- **THEN** the migration SHALL succeed and write nothing
