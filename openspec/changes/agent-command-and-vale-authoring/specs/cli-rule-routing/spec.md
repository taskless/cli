## MODIFIED Requirements

### Requirement: Route is the local authoring classifier

The CLI SHALL provide a `route` help recipe that instructs the agent to classify a rule-authoring request into one of five destinations — `create-legacy-rule`, `create-sg-rule`, `create-vale-rule`, `create-runtime-rule`, or `create-remote-rule` — using `taskless detect --json` signals plus the user's intent. The `route` recipe SHALL read the user's login state before dispatching, since it determines which destinations are reachable. It SHALL remain biased to stay local: local authoring that works SHALL NOT be abandoned for the service.

`route` SHALL decide the engine as part of this classification rather than deferring it to a separate topic. There is one decision, made from one reading of the evidence: whether a rule is expressible locally and which engine can express it are answered from the same signals, so splitting them costs a second fetch and a handoff without adding information.

Each destination SHALL be a topic an agent can fetch by name, so classifying produces a command to run rather than a category to interpret.

#### Scenario: Route fetches detection before classifying

- **WHEN** the agent fetches the `route` recipe to author a rule
- **THEN** the recipe SHALL direct the agent to run `taskless detect --json` and
  use its signals as input to the classification

#### Scenario: Route classifies into one of five destinations

- **WHEN** the agent follows `route`
- **THEN** it SHALL select exactly one of `create-legacy-rule`, `create-sg-rule`, `create-vale-rule`, `create-runtime-rule`, or `create-remote-rule`
- **AND** it SHALL fetch the corresponding recipe to perform the authoring

#### Scenario: Every destination resolves to a recipe

- **WHEN** any destination `route` can name is fetched
- **THEN** a recipe of that exact name SHALL exist

#### Scenario: Service generation is offered only where it is a choice

- **WHEN** the rule is expressible locally AND the user is logged in
- **THEN** `route` MAY offer `create-remote-rule` as an alternative and ask the user
- **AND WHEN** the user is not logged in, or the rule is not expressible locally
- **THEN** `route` SHALL NOT pose service generation as a choice, because it is not one

#### Scenario: A logged-in runtime request routes straight to the service

- **WHEN** the rule requires the runtime engine AND the user is logged in
- **THEN** `route` SHALL name `create-remote-rule`
- **AND** no recipe SHALL forward the agent from one destination to another

#### Scenario: A logged-out runtime request reaches the explanation

- **WHEN** the rule requires the runtime engine AND the user is not logged in
- **THEN** `route` SHALL name `create-runtime-rule`

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

The engine criterion SHALL be stated once, in `route`'s destination table, which is where the comparison between engines is made. It SHALL NOT be stated in a separate chooser topic, and SHALL NOT be restated in the destination recipes.

One statement is the point. A criterion copied into each destination is five copies of one test, and the first edit to any of them is a divergence nobody notices — the drift this merge exists to remove, reappearing one level down. Destinations orient the reader to their own scope instead, which needs nothing about the other engines.

#### Scenario: The comparison lives in one place

- **WHEN** the embedded recipe set is inspected
- **THEN** exactly one recipe SHALL state the criterion distinguishing the engines from each other

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
