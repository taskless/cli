## ADDED Requirements

### Requirement: A deliberately-invoked demo path

The CLI SHALL provide a path that generates one runtime rule from a fixed
input the service holds, writes it, and verifies it, so the boundary between
this client and the rule service can be shown working rather than described.

It SHALL be invoked deliberately. Routing SHALL NOT reach it, and no recipe
that decides how to author a rule SHALL name it as a destination.

#### Scenario: The demo produces a complete runtime rule

- **WHEN** the demo path is invoked in a project
- **THEN** a runtime rule directory SHALL exist containing `check.ts` and at
  least one capture under `captures/`
- **AND** `verify` SHALL report that rule as valid

#### Scenario: Routing never sends an agent to the demo

- **WHEN** an agent fetches any authoring or routing recipe
- **THEN** the demo topic SHALL NOT appear as a destination in that recipe

### Requirement: The demo is invoked as a subcommand of an existing command

The demo SHALL be dispatched as `rule demo`, a subcommand of the existing
`rule` command. It SHALL NOT be registered as a new top-level subcommand, and
SHALL add no entry to the CLI's top-level command name list.

**Rationale.** The `agent` index renders a command listing built from the
top-level command tree, separately from its curated recipe listing. A new
top-level verb would be advertised there regardless of the recipe being
unlisted, so the demo would be hidden in one half of the same output and
announced in the other. Nesting under `rule` obtains the property by not
registering the command, which is the same reasoning that keeps the recipe out
of the curated list rather than teaching a renderer to skip it.

#### Scenario: The demo adds nothing to the top-level command listing

- **WHEN** the `agent` index is rendered
- **THEN** the command listing SHALL NOT contain a demo entry
- **AND** the listing SHALL be identical to the one rendered before the demo
  existed

### Requirement: The demo uses the well-known request and retrieval formats

The demo SHALL obtain its rule through the same two-stage flow as an ordinary
generated rule: a request that returns a ticket and a status, then a retrieval
by that ticket returning the status and the delivered rules.

The retrieval response SHALL use the published file-set variant. The demo SHALL
NOT introduce a payload shape that only the demo consumes.

**Rationale.** A demo exists to show the path a user is on. A bespoke shape
would demonstrate something no user receives, and would let the two shapes
drift without anything detecting it.

#### Scenario: The demo reuses the ordinary delivery writer

- **WHEN** the demo receives its rule
- **THEN** the rule SHALL be written by the same writer that writes a generated
  rule, subject to the same path, completeness and layout validation

#### Scenario: A malformed demo payload is refused, not written

- **WHEN** the demo receives a rule that fails delivery validation
- **THEN** nothing SHALL be written for that rule
- **AND** the failure SHALL name what was wrong with the payload

### Requirement: The demo reports a terminal failure rather than inventing a rule

The CLI SHALL report a terminal status the service returns for a demo request,
together with the reason the service sent, and SHALL write nothing for that
request.

**Rationale.** A demo that invents a rule when generation fails is worse than a
demo that fails, because it looks like success.

#### Scenario: Generation cannot be served

- **WHEN** the demo request terminates as unsupported or failed
- **THEN** the CLI SHALL surface the service's reason
- **AND** SHALL NOT write a rule

### Requirement: The demo does not weaken the runtime execution gate

The demo SHALL NOT cause a runtime rule to execute without the verification
`check` already requires. No demo rule identifier, and no flag introduced for
the demo, SHALL bypass signature verification.

**Rationale.** Signature verification is what stands between a payload fetched
over the network and arbitrary code executing on a developer's machine. An
exception that exists for a demo is an exception, and the identifier it keys on
is visible to anyone who reads the recipe.

#### Scenario: A demo rule is not executed by an unauthenticated check

- **WHEN** `check` runs with no authentication in a project holding a demo rule
- **THEN** the demo rule SHALL be skipped with the reason `check` already gives
  for an unverified runtime rule

#### Scenario: Executing a demo rule uses the documented escape

- **WHEN** a user runs `check` with `--dangerously-run-scripts`
- **THEN** the demo rule SHALL execute under that flag's existing warning, and
  under no other mechanism

### Requirement: What the demo writes can be removed

A demo rule that has been written SHALL be removable by rule identifier through
the ordinary deletion path, leaving no residue that `verify` or `check` would
later report.

#### Scenario: Deleting the demo rule

- **WHEN** the user deletes the demo rule by its identifier
- **THEN** its rule directory SHALL be removed
- **AND** a subsequent `check` SHALL NOT report it
