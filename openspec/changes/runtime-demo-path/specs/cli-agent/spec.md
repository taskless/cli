## ADDED Requirements

### Requirement: The topic index is curated, and a topic may be absent from it

The `agent` index SHALL list a curated set of topics rather than every embedded
recipe. A recipe MAY exist and be retrievable by name while being absent from
that index.

**Rationale.** Some topics are invoked deliberately rather than discovered — a
demonstration path, for instance, which routing must never send an agent to.
The index is a hand-maintained list and lookup is by name, so absence from the
index is the existing behaviour; this states it as intended rather than leaving
it to be read as an oversight and "fixed".

#### Scenario: An unlisted topic is still retrievable by name

- **WHEN** an agent requests a topic that exists as a recipe but is not in the
  index
- **THEN** the CLI SHALL return that recipe

#### Scenario: An unlisted topic does not appear in the index

- **WHEN** the topic index is rendered
- **THEN** a topic that is not in the curated list SHALL NOT appear in it

### Requirement: The rendered index has two independently-sourced listings

The `agent` index SHALL be treated as two separate listings: a command listing
built from the registered top-level subcommands, and the curated recipe
listing. Absence from the curated recipe listing SHALL NOT be relied on to keep
an entry out of the command listing, because the two share no source.

**Rationale.** The command listing iterates the top-level command tree and
filters only `agent` itself; it never consults the curated recipe list. A
deliberately-invoked capability that registers a new top-level command is
therefore advertised there no matter what the recipe list says. Stating the two
listings separately keeps a later reader from assuming one requirement covers
both, which is how a topic ends up hidden in one half of its own output.

#### Scenario: A deliberately-invoked capability adds no top-level command

- **WHEN** a capability is meant to be invoked deliberately rather than
  discovered from the index
- **THEN** it SHALL NOT be registered as a new top-level subcommand
- **AND** the command listing SHALL be unchanged by its addition
