# cli-rule-routing Specification

## Purpose

TBD - created by archiving change local-rule-routing. Update Purpose after archive.

## Requirements

### Requirement: Route is the local authoring classifier

The CLI SHALL provide a `route` help recipe that instructs the agent to classify
a rule-authoring request into one of three destinations — `existing`, `static`,
or `remote` — using `taskless detect --json` signals plus the user's intent. The
`route` recipe SHALL be biased to stay local: it SHALL prefer `existing` or
`static` and SHALL treat `remote` as the escalation of last resort.

#### Scenario: Route fetches detection before classifying

- **WHEN** the agent fetches the `route` recipe to author a rule
- **THEN** the recipe SHALL direct the agent to run `taskless detect --json` and
  use its signals as input to the classification

#### Scenario: Route classifies into one of three destinations

- **WHEN** the agent follows `route`
- **THEN** it SHALL select exactly one of `existing`, `static`, or `remote`
- **AND** it SHALL fetch the corresponding recipe to perform the authoring

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

The CLI SHALL provide an `existing` help recipe that instructs the agent to
author a rule in a linter already detected in the repository, expressed in that
tool's own dialect. The recipe SHALL direct the agent to source authoring
knowledge first from the repository's own existing rules and only then from the
agent's own web research. The recipe SHALL NOT embed or rely on a Taskless-
maintained catalog of linter rules.

#### Scenario: Repo-first knowledge sourcing

- **WHEN** the agent follows `existing` for a detected linter
- **THEN** it SHALL first mine the repository's existing rules of that kind for
  house style
- **AND** SHALL fall back to web research (WebFetch/WebSearch) only when the
  repository signal is insufficient

#### Scenario: Existing path is author-only

- **WHEN** the agent authors a rule via `existing`
- **THEN** the recipe SHALL make clear the user's own toolchain runs the rule and
  that `taskless check` does not execute the external linter

### Requirement: Static recipe authors a verified local ast-grep rule

The CLI SHALL provide a `static` help recipe that instructs the agent to author a
local ast-grep rule on-device, without calling the Taskless service, and to
verify it against the user's success and failure cases before reporting success.
The recipe SHALL produce the canonical on-disk rule shape and paths used by remote
generation so that `check`, `improve`, and `verify` see a single dialect.

#### Scenario: Local authoring without the service

- **WHEN** the agent follows `static`
- **THEN** it SHALL write the rule on-device without requiring login or the
  Taskless API

#### Scenario: Verification gates success

- **WHEN** the agent authors a static rule
- **THEN** it SHALL verify the rule against the provided success/failure cases
  before reporting the rule as complete

#### Scenario: Canonical output shape

- **WHEN** the agent writes a static rule to disk
- **THEN** the files, paths, and shape SHALL match those produced by remote
  generation

### Requirement: Remote recipe collects inputs and delegates to the service

The CLI SHALL provide a `remote` help recipe that instructs the agent to gather
the inputs required to call the Taskless service and to invoke the existing rule
generation backend, which runs the service-side classifier and returns either a
static or a runtime rule. The `remote` recipe SHALL require authentication and
SHALL NOT itself decide static versus runtime.

#### Scenario: Remote requires authentication

- **WHEN** the agent follows `remote` while logged out
- **THEN** the recipe SHALL direct the agent to the authentication flow before
  submitting the request

#### Scenario: Static-versus-runtime is decided by the service

- **WHEN** the agent submits an authored request via `remote`
- **THEN** the recipe SHALL rely on the service to classify static versus runtime
- **AND** SHALL NOT make that determination locally

#### Scenario: Remote output matches local on-disk shape

- **WHEN** the service returns a generated rule via `remote`
- **THEN** the written files and paths SHALL match the shape produced by the
  local `static` path

### Requirement: An engine-selection topic states which engine can enforce a rule

The CLI SHALL provide a knowledge topic that decides, for a requested rule, **which engine can enforce it** — `sg`, `vale`, or `runtime` — valued as the engine's on-disk directory name. The topic SHALL define each engine by the information a rule fundamentally needs:

- **`sg`** — expressible as a pattern over a single file's syntax tree, including correlation between constructs within that same file via relational operators.
- **`vale`** — the target is prose or markup content rather than code structure.
- **`runtime`** — needs information no single file's syntax tree contains: cross-file consistency, import or call graph, comparison against a non-code file, file metadata, or values requiring normalization a static pattern cannot express.

The topic SHALL instruct that the decision follow from what the rule fundamentally needs rather than how the request was phrased, and that the reasoning be stated before the engine is named.

#### Scenario: Engine named for a single-file structural rule

- **WHEN** the topic is applied to a request expressible as a pattern over one file's syntax tree
- **THEN** it selects `sg`

#### Scenario: Engine named for a prose rule

- **WHEN** the topic is applied to a request targeting prose or markup content
- **THEN** it selects `vale`

#### Scenario: Engine named for a cross-file rule

- **WHEN** the topic is applied to a request requiring information beyond a single file's syntax tree
- **THEN** it selects `runtime`

### Requirement: Engine selection is a separate axis from authoring destination

The engine-selection topic SHALL decide only which engine enforces a rule, and SHALL NOT decide where the rule is authored — that remains the `route` topic's concern. Locally the two compose, `route` first and engine selection second.

The topic SHALL NOT describe login, reconciliation, or signing as inputs to the engine choice: `sg` and `vale` are both static-tier, and only `runtime` carries those concerns, so trust tier is a distinct axis from engine selection.

#### Scenario: Topic stays clear of authoring destination

- **WHEN** the engine-selection topic is applied
- **THEN** it names an engine and does not select among `existing`, `static`, or `remote` authoring destinations

#### Scenario: Trust tier is not an engine-selection input

- **WHEN** the topic distinguishes `sg` from `vale`
- **THEN** it does so on the prose-versus-structure axis, not on any auth, reconcile, or signing property, since both are static-tier

### Requirement: Available code context outranks the phrasing of the request

Where code or diff context is available, the engine-selection topic SHALL weigh the concrete syntactic form present in the repository above the wording of the request, since the same request routes differently depending on the form the code actually takes.

#### Scenario: Concrete form changes the engine

- **WHEN** a rule is statically correlatable in the form the repository actually contains
- **THEN** the topic selects `sg`
- **AND WHEN** the equivalent rule requires normalizing a captured value to match a declaration elsewhere
- **THEN** it selects `runtime`, despite an identically phrased request

### Requirement: Ambiguity resolves to an engine known to be available

When no engine is clearly indicated, the engine-selection topic SHALL direct the reader to choose an engine whose availability can be asserted in the situation at hand, and to give that availability as the reason for the call. The topic SHALL NOT name a fixed fallback engine. Both `sg` and `vale` ship as platform binaries, so either can be the missing one on an unsupported architecture or where an install was blocked; server-side the constraint is different again, `sg` being the only ungated route. A named default is wrong in whichever of those situations it failed to anticipate, which is why the requirement is stated as a property rather than as a fact about any one engine.

#### Scenario: Ambiguous request resolves to an assertably available engine

- **WHEN** the available context does not disambiguate which engine can enforce a rule
- **THEN** the topic selects an engine whose availability it can assert, and states that availability as the reasoning that made the call close

#### Scenario: The default is never an unavailable engine

- **WHEN** an engine is unavailable in the current environment, such as the Vale binary being absent
- **THEN** the ambiguity default SHALL NOT name it
