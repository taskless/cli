## ADDED Requirements

### Requirement: Migration 9 resumes after an interrupted run

Migration `9` SHALL be resumable: after a run that ends part-way through, for
any reason, a subsequent run SHALL bring the scaffold to the same end state a
single uninterrupted run would have reached.

Every edit a rule needs SHALL be made inside the rule's existing directory, and
the directory rename SHALL be the LAST operation of that rule's rename. A
directory rename is a single atomic filesystem operation, so it is the point at
which a rule is done, and no earlier step SHALL be observable as progress.

Because the directory rename is also the operation that clears the collision,
the collision scan SHALL remain a sound resume signal: a rule interrupted
before its commit still holds the colliding id and SHALL be enumerated again,
and a rule interrupted after its commit is already consistent. The migration
SHALL therefore still write nothing when no collision remains.

Each step inside a rule's directory SHALL tolerate having already run:

- a rule file whose old name is gone and whose new name is present SHALL still
  have its `id:` field rewritten, rather than being treated as absent
- a fixture already carrying the target prefix SHALL NOT be renamed again, and
  only its `id:` field SHALL follow
- a file rewrite SHALL be committed by renaming a temporary sibling over the
  target, so an interrupted write SHALL NOT leave a truncated rule file

The predicate selecting fixtures to rename SHALL NOT match the names it
produces. The target id is always the old id plus a suffix, so a predicate
keyed only on the old id accepts its own output and appends the suffix twice.

#### Scenario: A run interrupted before a rule's directory rename is resumed

- **WHEN** migration 9 fails after rewriting a colliding rule's file, `id:`
  field or fixtures but before its directory is renamed
- **THEN** the rule SHALL still hold the colliding id
- **AND** a subsequent run SHALL enumerate it again and complete the rename
- **AND** the rule's directory name, rule file name, fixture names and every
  `id:` field SHALL agree afterwards

#### Scenario: A run interrupted after a rule's directory rename leaves that rule whole

- **WHEN** migration 9 fails immediately after a rule's directory is renamed
- **THEN** that rule SHALL already carry its new id in its directory name, its
  rule file, its fixtures and every `id:` field
- **AND** a subsequent run SHALL have nothing to do for it

#### Scenario: A fixture already at the target prefix is not suffixed twice

- **WHEN** a colliding `sg` rule's `.tests/` holds a fixture whose name already
  begins with the target id, whether written by hand before the migration ran
  or renamed by an interrupted run
- **THEN** the fixture SHALL keep its name
- **AND** its `id:` field SHALL be rewritten to the new id
