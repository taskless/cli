## ADDED Requirements

### Requirement: The engine binary resolver is published

The CLI SHALL publish, as an importable entry, the resolver it uses to locate the
engine binaries it executes, together with the per-engine package specs that
resolver takes.

A consumer that verifies a generated rule has to execute it, and a rule's
behaviour is a property of the engine version that runs it. Tracking that version
separately from the CLI version means two pins in two repositories, which drift
silently: a `0.41.1` sandbox verified a capture clean that a `0.45.2` developer
machine then matched nothing with. Installing the CLI and asking it where the
binary is makes the engine version a consequence of the CLI pin rather than a
parallel fact.

#### Scenario: A consumer resolves the same binary the CLI executes

- **WHEN** a consumer imports the published runtimes entry and resolves an engine
  spec
- **THEN** it SHALL receive the absolute path of a binary that identified itself
  as that engine
- **AND** the resolver and the specs SHALL be the same modules the CLI itself
  dispatches on, not a copy kept in step

#### Scenario: The pinned platform build is preferred

- **WHEN** the engine's pinned per-platform package is installed
- **THEN** resolution SHALL try it before a linked binary or one on `PATH`

### Requirement: A binary that cannot be resolved is reported as a value

Resolution SHALL report a miss by returning an absent path alongside the list of
locations searched, and SHALL NOT throw.

The two sides want opposite things from a miss, and neither can be imposed on the
other. `taskless check` runs several engines: a host without Vale installed must
lose the Vale rules rather than the whole run. A verifier must fail closed,
because a sandbox whose optional dependency did not install resolves nothing for
the same reason a laptop does, and skipping verification there reports a clean
generation for a rule nothing checked. Encoding the miss as a value is what lets
each caller choose; the entry SHALL document that choice rather than leaving it
to be inferred.

#### Scenario: Nothing resolves

- **WHEN** no candidate location holds a binary that identifies itself as the
  engine
- **THEN** resolution SHALL return an absent path
- **AND** it SHALL return the locations it searched, in order
- **AND** it SHALL NOT throw

#### Scenario: A file exists but is not the binary

- **WHEN** a candidate path exists but does not identify itself as the engine
- **THEN** resolution SHALL reject that candidate and continue searching

### Requirement: A host-bound entry declares its host requirement in its path

An entry that requires Node SHALL carry that requirement in its published
specifier rather than only in documentation.

The published surface is what a consumer reads first. A specifier that names the
host states the constraint before a bundler error has to, and it distinguishes
this entry from the host-free ones beside it, which a Worker imports today.

#### Scenario: The specifier names the host

- **WHEN** a consumer reads the import path of an entry that spawns processes,
  reads the filesystem, or consults `PATH`
- **THEN** the path SHALL identify the host it requires

### Requirement: Every published export declares whether it is host-bound

The build SHALL classify every entry named in the package's `exports` as either
graph-asserted host-free or deliberately host-bound, and SHALL fail when a
published export belongs to neither.

The graph assertion is opt-in, so before this requirement an entry that joined no
list was checked by nothing, and forgetting to enroll a new surface was
indistinguishable from exempting it on purpose. Requiring a classification turns
the exemption into a claim a reviewer can disagree with. A host-bound entry is
excused only from the host-capability rule; it SHALL still be forbidden from
reaching the CLI's command layer, because needing a subprocess is not a reason to
also ship the command tree.

#### Scenario: An unclassified published export fails the build

- **WHEN** the package publishes an export whose entry appears in neither
  classification
- **THEN** the build SHALL fail
- **AND** the artifact SHALL NOT be emitted

#### Scenario: A published export names no built entry

- **WHEN** a published export points at a file the build does not emit
- **THEN** the build SHALL fail

#### Scenario: A host-bound entry reaching the command layer fails the build

- **WHEN** a host-bound entry's graph reaches the CLI entry module
- **THEN** the build SHALL fail
- **AND** the check SHALL be made against the entry module rather than against
  the emitted CLI chunk, since bundling may move the command layer into a shared
  chunk the CLI entry itself merely re-exports
