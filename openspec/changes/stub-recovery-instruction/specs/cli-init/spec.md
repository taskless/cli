## ADDED Requirements

### Requirement: A reference stub says how to restore a missing canonical file

A reference stub's body SHALL state what to do when the canonical file it points at is not present, naming a command that restores it. A stub that only delegates leaves a reader who follows it at a dead end, and the two states that produce a missing canonical file (an install whose untracked files never reached this working directory, and a project that ignores the canonical store) are both reached without anyone doing anything wrong.

Skill stubs and command stubs SHALL carry the same instruction.

The command named SHALL be the one that runs the build which wrote the stub, resolved the same way canonical content resolves it. A stub emitted by a development or nightly build SHALL NOT direct the reader to the released package.

The command named SHALL install without an interactive terminal, since the reader of a stub is typically an agent in a non-interactive context.

Stub content SHALL carry nothing that varies per release, so that adding this instruction changes the footprint outside the canonical store exactly once.

A stub already on disk whose body predates this instruction SHALL be rewritten once by the next install, rather than waiting for its frontmatter to change. Detection of such a stub SHALL NOT depend on the build that wrote it, so that builds with different invocations do not rewrite one another's stubs.

#### Scenario: Stub names the command that restores a missing canonical file

- **WHEN** the CLI writes a skill stub or a command stub
- **THEN** its body SHALL say what to do if the canonical file does not exist
- **AND** SHALL name a command that restores it

#### Scenario: A development build points at itself

- **WHEN** a `dev` or `self` build writes a stub
- **THEN** the command named SHALL be that build's own invocation
- **AND** SHALL NOT be the released package

#### Scenario: Stub bytes do not move with the CLI version

- **WHEN** two installs of different CLI versions write a stub for the same skill
- **THEN** the two stubs SHALL be identical

#### Scenario: An older stub is rewritten once

- **WHEN** an install finds a stub whose body carries no recovery instruction
- **THEN** the install SHALL rewrite that stub
- **AND** a subsequent install SHALL leave the rewritten stub untouched
