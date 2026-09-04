# cli-layout-export Specification

## Purpose

TBD - created by archiving change generator-payload-alignment. Update Purpose after archive.

## Requirements

### Requirement: The rule layout is published as data

The CLI SHALL publish its rule-layout table — the known engines, each engine's rule file, config
file and captures directory, and the rules and tests directory names — as an importable module,
so that a service building a rule payload validates against the table rather than transcribing it.

A shape documented in prose drifts: the same layout was described in seven stale code comments and
in the runtime-execution spec, all naming a pre-migration path. A shape published as data does not.

#### Scenario: The layout is importable

- **WHEN** a consumer imports the published layout entry
- **THEN** it SHALL receive the engine list and each engine's layout as values
- **AND** the values SHALL be the same ones the CLI itself dispatches on

### Requirement: The published layout carries no CLI runtime

The published entry SHALL NOT reach the filesystem, the network, telemetry, or the command tree,
so a Worker can import it. This SHALL be enforced by the build — the published chunk graph is
checked at build time, failing the build rather than relying on review — matching how the prompts
entry is already constrained.

#### Scenario: A runtime import fails the build

- **WHEN** the published layout graph reaches a host capability
- **THEN** the build SHALL fail
- **AND** the artifact SHALL NOT be emitted

### Requirement: The shapes a consumer parses are published as data

The CLI SHALL publish the schemas describing its `--json` output as an
importable module, so that a consumer parsing that output validates against the
schema the CLI emits from rather than transcribing it into a hand-written type.

This is the layout table's argument applied to the other half of the contract. A
consumer of `verify --json` today writes its own interface for the envelope, and
a hand-written interface is a copy that nothing checks: the CLI can add a field,
change a field's meaning, or rename an error code, and the copy stays confidently
wrong until something downstream misbehaves.

The published module SHALL carry no host capability. A schema is data, and a
consumer wanting to know the shape of the CLI's output SHALL NOT thereby acquire
a dependency on the filesystem, a process spawn, or the command tree.

The CLI SHALL remain the execution surface. Publishing the shapes does not
publish the operations: a consumer runs `taskless verify --json` and parses the
result, and no function that performs verification is exported.

#### Scenario: A consumer parses verify output against the published schema

- **WHEN** a consumer runs `taskless verify --json` and parses its output
- **THEN** the schema that output was produced against SHALL be importable
- **AND** parsing SHALL fail loudly on output the schema does not describe, rather than silently yielding a partially-typed value

#### Scenario: The schema module reaches no host capability

- **WHEN** the package is built
- **THEN** the schema entry's import graph SHALL reach no filesystem, process, or network capability
- **AND** it SHALL NOT reach the CLI entry
