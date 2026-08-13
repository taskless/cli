## MODIFIED Requirements

### Requirement: Route is the local authoring classifier

The CLI SHALL provide a `route` help recipe that instructs the agent to classify a rule-authoring request into one of four destinations — `create-legacy-rule`, `create-sg-rule`, `create-vale-rule`, or `create-runtime-rule` — using `taskless detect --json` signals plus the user's intent. The `route` recipe SHALL be biased to stay local, treating service generation as an escalation available when local authoring cannot express the rule rather than as a peer destination.

`route` SHALL decide the engine as part of this classification rather than deferring it to a separate topic. There is one decision, made from one reading of the evidence: whether a rule is expressible locally and which engine can express it are answered from the same signals, so splitting them costs a second fetch and a handoff without adding information.

Each destination SHALL be a topic an agent can fetch by name, so classifying produces a command to run rather than a category to interpret.

#### Scenario: Route fetches detection before classifying

- **WHEN** the agent fetches the `route` recipe to author a rule
- **THEN** the recipe SHALL direct the agent to run `taskless detect --json` and
  use its signals as input to the classification

#### Scenario: Route classifies into one of four destinations

- **WHEN** the agent follows `route`
- **THEN** it SHALL select exactly one of `create-legacy-rule`, `create-sg-rule`, `create-vale-rule`, or `create-runtime-rule`
- **AND** it SHALL fetch the corresponding recipe to perform the authoring

#### Scenario: Every destination resolves to a recipe

- **WHEN** any destination `route` can name is fetched
- **THEN** a recipe of that exact name SHALL exist

#### Scenario: The engine is decided without a second fetch

- **WHEN** the agent follows `route`
- **THEN** it SHALL arrive at an engine-specific recipe without fetching a separate engine-selection topic

### Requirement: Static recipe authors a verified local ast-grep rule

The CLI SHALL provide a `create-sg-rule` help recipe that instructs the agent to author a
local ast-grep rule on-device, without calling the Taskless service, and to
verify it against the user's success and failure cases before reporting success.
The recipe SHALL produce the canonical on-disk rule shape and paths used by remote
generation so that `check`, `improve`, and `verify` see a single dialect.

The recipe SHALL be named for the artifact it produces rather than for a trust tier. "Static" describes when a rule runs, which is a different axis from which engine enforces it, and naming the ast-grep authoring path after the tier taught the conflation that engine selection exists to correct.

#### Scenario: Local authoring without the service

- **WHEN** the agent follows `create-sg-rule`
- **THEN** it SHALL write the rule on-device without requiring login or the
  Taskless API

### Requirement: Trust tier is not an engine-selection input

Engine reasoning SHALL NOT treat login, reconciliation, or signing as inputs to the engine choice: `sg` and `vale` are both static-tier, and only `runtime` carries those concerns, so trust tier is a distinct axis from which engine can express a rule.

#### Scenario: Trust tier is not an engine-selection input

- **WHEN** the reasoning distinguishes `sg` from `vale`
- **THEN** it does so on the prose-versus-structure axis, not on any auth, reconcile, or signing property, since both are static-tier

## ADDED Requirements

### Requirement: Engine reasoning lives in route and in each destination

The engine criterion SHALL be stated in `route`, which applies it to dispatch, and in each `create-*-rule` recipe, which states the evidence that makes its own engine the right one. It SHALL NOT be stated in a separate chooser topic.

Distributing it this way is what lets the reasoning stay exportable. A consumer outside the CLI has no `route` step and cannot run `taskless detect --json`, so a chooser topic is unusable to it; a destination that states its own criterion is usable by anything that can read one recipe. It also removes the drift class where a chooser and its destinations disagree about when each applies.

#### Scenario: A destination states when it applies

- **WHEN** an agent or consumer reads `create-sg-rule` or `create-vale-rule`
- **THEN** the recipe SHALL state the evidence that makes that engine the right one for a rule

#### Scenario: No separate chooser topic exists

- **WHEN** the embedded recipe set is inspected
- **THEN** there SHALL be no topic whose only purpose is selecting among engines

## REMOVED Requirements

### Requirement: Engine selection is a separate axis from authoring destination

**Reason**: The separation cost an agent two fetches and a handoff to answer one question. Whether a rule is expressible locally and which engine can express it are answered from the same evidence, so reading it twice added a failure point without adding information.

**Migration**: The engine criterion moves into `route` and into each `create-*-rule` recipe (see "Engine reasoning lives in route and in each destination"). The one part of this requirement that was not about the split — that trust tier is a distinct axis — is retained as its own requirement above. Consumers that fetched `engine-selection` read the destination recipes instead, which is the surface `TOPICS` now exports.

### Requirement: An engine-selection topic states which engine can enforce a rule

**Reason**: The topic it required no longer exists as a separate recipe.

**Migration**: Its content — the three engine definitions, evidence-before-answer, and the boundary cases — moves into `route` and the `create-*-rule` recipes. The requirements that constrained the reasoning itself ("Available code context outranks the phrasing of the request", "Ambiguity resolves to an engine known to be available") remain in force and now bind `route` and the destination recipes rather than a standalone topic.
