## ADDED Requirements

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

### Requirement: Ambiguity defaults to an engine known to be available

When no engine is clearly indicated, the engine-selection topic SHALL default to `sg` and record why the call was close. The topic SHALL state this as a property — the default names an engine known to be available — rather than as a bare fact about `sg`, so it stays correct wherever an engine can be unavailable or a route withheld.

#### Scenario: Ambiguous request defaults to sg

- **WHEN** the available context does not disambiguate which engine can enforce a rule
- **THEN** the topic selects `sg` and states the reasoning that made the call close

#### Scenario: The default is never an unavailable engine

- **WHEN** an engine is unavailable in the current environment, such as the Vale binary being absent
- **THEN** the ambiguity default SHALL NOT name it
