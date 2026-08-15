# cli-rule-routing Specification

## Purpose

TBD - created by archiving change local-rule-routing. Update Purpose after archive.
## Requirements
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

### Requirement: Route states reasoning before naming a destination

The `route` recipe SHALL require the agent to write an explicit rationale before
naming a destination. The rationale SHALL cover what the `detect` signals show,
whether an existing linter plausibly already covers the request, whether the
pattern is expressible as a simple static ast-grep rule, and the resulting
confidence that the request is locally solvable. The destination SHALL be emitted
only after this rationale, and SHALL follow from it.

#### Scenario: Rationale precedes the route decision

- **WHEN** the agent follows `route` to classify a request
- **THEN** it SHALL produce a written rationale covering the detection signals,
  existing-linter coverage, ast-grep expressibility, and local-solvability
  confidence
- **AND** it SHALL name the destination (`existing`, `static`, or `remote`) only
  after that rationale

#### Scenario: Route is not named before reasoning

- **WHEN** the agent has not yet articulated its reasoning
- **THEN** the recipe SHALL NOT permit committing to a destination
- **AND** the destination SHALL be a conclusion of the rationale, not asserted
  ahead of it

### Requirement: Route commits to the believed-correct path on reasonable confidence

The `route` recipe SHALL determine the destination upfront from `detect` signals
and the user's intent, committing to the path it believes is correct. The bar to
commit to a local path SHALL be **reasonable confidence**, not certainty. Routing
distinguishes three states: reasonable confidence the request IS locally solvable
selects a local path; reasonable belief the request is NOT locally solvable selects
`remote` directly, without first attempting a local rule; genuine inability to
judge either way is uncertainty, which SHALL be resolved by asking the user (see
the clarifying-question scenario) and SHALL NOT by itself select `remote`. The
recipe SHALL NOT use a deliberate local attempt-and-fail with no genuine belief of
success as the mechanism for choosing `remote`.

#### Scenario: Reasonably-confident-local commits locally without a justification probe

- **WHEN** `route` is reasonably confident the request fits an existing linter or
  a simple static ast-grep pattern
- **THEN** it SHALL select `existing` or `static` and proceed locally
- **AND** it SHALL NOT run a throwaway local attempt whose only purpose is to
  justify the choice

#### Scenario: Believed-not-local routes remote upfront

- **WHEN** `route` reasonably believes the request cannot be solved locally — a
  positive judgment, not mere inability to tell
- **THEN** it SHALL select `remote` directly
- **AND** it SHALL NOT manufacture a deliberate local failure to reach that
  decision

#### Scenario: Uncertainty biases toward asking, not toward login

- **WHEN** `route` cannot reasonably place a request as local or remote
- **THEN** it SHALL prefer clarifying with the user over defaulting to `remote`
- **AND** uncertainty alone SHALL NOT be treated as a reason to consume a
  generation via `remote`

### Requirement: A believed-local path that fails escalates only after confirmation

The `route` recipe SHALL treat try-verify-escalate as a legitimate failure
fallback: when it committed to a local path on reasonable confidence and the
authored rule then fails verification against the user's success/failure cases, it
SHALL surface the failure and SHALL obtain explicit user confirmation before
calling the Taskless service. The recipe SHALL NOT silently fall through from a
failed local attempt to a service call.

#### Scenario: Failed local attempt prompts before spending a generation

- **WHEN** a `static` rule the agent committed to fails verification
- **THEN** the recipe SHALL inform the user the local rule could not capture the
  cases
- **AND** SHALL state that generating via the Taskless service uses a generation
  and requires login
- **AND** SHALL call the service only after the user confirms

#### Scenario: No silent fall-through to the service

- **WHEN** a believed-local attempt fails
- **THEN** the recipe SHALL NOT invoke `remote` / the service without an explicit
  user confirmation step

### Requirement: Route asks the user when multiple paths fit

The `route` recipe SHALL present the viable options to the user with their
trade-offs, rather than silently selecting one, whenever more than one destination
genuinely fits a request (most commonly both `existing` and `static`). The
trade-off framing SHALL note that `remote` consumes a generation and requires
login, so it is appropriate when a request cannot be solved locally rather than as
a default.

#### Scenario: Both local paths viable surfaces a choice

- **WHEN** the repository has a detected linter that fits AND the pattern is a
  clean local static ast-grep rule
- **THEN** `route` SHALL present both `existing` and `static` with their
  trade-offs and let the user choose

#### Scenario: Trade-off framing names the generation cost of remote

- **WHEN** `route` presents options that include `remote`
- **THEN** it SHALL state that `remote` consumes a generation and requires login
- **AND** SHALL frame `remote` as the path for what cannot be solved locally

### Requirement: Existing recipe authors in the detected linter's dialect

The CLI SHALL provide a `create-legacy-rule` help recipe that instructs the agent to author a rule in a linter already detected in the repository, expressed in that tool's own dialect. The recipe SHALL direct the agent to source authoring knowledge first from the repository's own existing rules and only then from the agent's own web research. The recipe SHALL NOT embed or rely on a Taskless-maintained catalog of linter rules.

The recipe is named for the artifact it produces. "Existing" described the repository's state rather than the rule being written, which is not something an agent can address by name.

#### Scenario: Repo-first knowledge sourcing

- **WHEN** the agent follows `create-legacy-rule`
- **THEN** it SHALL read the repository's own rules for that linter before consulting any external source

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

### Requirement: Remote recipe collects inputs and delegates to the service

The CLI SHALL provide a `create-remote-rule` help recipe that instructs the agent to gather the inputs required to call the Taskless service and to invoke the existing rule generation backend, which runs the service-side classifier and returns either a static or a runtime rule. The recipe SHALL require authentication and SHALL NOT itself decide static versus runtime.

#### Scenario: The remote recipe requires authentication

- **WHEN** the agent follows `create-remote-rule` while logged out
- **THEN** the recipe SHALL direct the agent to `auth` rather than calling the service

### Requirement: Available code context outranks the phrasing of the request

Where code or diff context is available, `route` SHALL weigh the concrete syntactic form present in the repository above the wording of the request, since the same request routes differently depending on the form the code actually takes.

This bound the standalone engine-selection topic. That topic is gone, but the reasoning is not — it now binds the place the decision is actually made.

#### Scenario: Concrete form changes the engine

- **WHEN** a rule is statically correlatable in the form the repository actually contains
- **THEN** `route` selects `create-sg-rule`
- **AND WHEN** the equivalent rule requires normalizing a captured value to match a declaration elsewhere
- **THEN** it selects a runtime destination, despite an identically phrased request

### Requirement: Ambiguity resolves to an engine known to be available

When no engine is clearly indicated, `route` SHALL direct the reader to choose an engine whose availability can be asserted in the situation at hand, and to give that availability as the reason for the call. It SHALL NOT name a fixed fallback engine. Both `sg` and `vale` ship as platform binaries, so either can be the missing one on an unsupported architecture or where an install was blocked; server-side the constraint is different again, `sg` being the only ungated route. A named default is wrong in whichever of those situations it failed to anticipate, which is why the requirement is stated as a property rather than as a fact about any one engine.

#### Scenario: Ambiguous request resolves to an assertably available engine

- **WHEN** the available context does not disambiguate which engine can enforce a rule
- **THEN** `route` selects an engine whose availability it can assert, and states that availability as the reasoning that made the call close

#### Scenario: The default is never an unavailable engine

- **WHEN** an engine is unavailable in the current environment, such as the Vale binary being absent
- **THEN** the ambiguity default SHALL NOT name it

### Requirement: Trust tier is not an engine-selection input

Engine reasoning SHALL NOT treat login, reconciliation, or signing as inputs to the engine choice: `sg` and `vale` are both static-tier, and only `runtime` carries those concerns, so trust tier is a distinct axis from which engine can express a rule.

#### Scenario: Trust tier is not an engine-selection input

- **WHEN** the reasoning distinguishes `sg` from `vale`
- **THEN** it does so on the prose-versus-structure axis, not on any auth, reconcile, or signing property, since both are static-tier

### Requirement: Engine reasoning lives in route and in each destination

The engine criterion SHALL be stated once, in `route`'s destination table, which is where the comparison between engines is made. It SHALL NOT be stated in a separate chooser topic, and SHALL NOT be restated in the destination recipes.

One statement is the point. A criterion copied into each destination is five copies of one test, and the first edit to any of them is a divergence nobody notices — the drift this merge exists to remove, reappearing one level down. Destinations orient the reader to their own scope instead, which needs nothing about the other engines.

#### Scenario: The comparison lives in one place

- **WHEN** the embedded recipe set is inspected
- **THEN** exactly one recipe SHALL state the criterion distinguishing the engines from each other

#### Scenario: No separate chooser topic exists

- **WHEN** the embedded recipe set is inspected
- **THEN** there SHALL be no topic whose only purpose is selecting among engines

