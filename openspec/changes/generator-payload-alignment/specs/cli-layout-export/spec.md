## ADDED Requirements

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
