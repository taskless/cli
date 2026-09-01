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
