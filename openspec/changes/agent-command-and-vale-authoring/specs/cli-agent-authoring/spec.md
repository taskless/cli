## ADDED Requirements

### Requirement: Every engine a rule can be routed to has an authoring recipe

The CLI SHALL provide an authoring recipe for each engine `route` can name: `create-sg-rule`, `create-vale-rule`, and `create-runtime-rule`, alongside `create-legacy-rule` for a linter the repository already uses.

A decision procedure that can produce an answer with no destination is incomplete. Engine selection can conclude `vale` or `runtime`, and before this change neither had a procedure, so an agent that reasoned correctly arrived nowhere.

#### Scenario: Each engine choice reaches a procedure

- **WHEN** engine selection concludes `sg`, `vale`, or `runtime`
- **THEN** a recipe exists that authors a rule for that engine

#### Scenario: A legacy destination exists for repositories with their own linter

- **WHEN** the repository already runs a linter that can express the rule
- **THEN** `create-legacy-rule` SHALL author it in that tool's own dialect

### Requirement: The Vale authoring recipe covers rule, scope, and fixtures

The `create-vale-rule` recipe SHALL instruct the agent to produce three artifacts, and SHALL state that a rule is incomplete without all three:

1. A Vale style file under `.taskless/vale/rules/<id>.yml`.
2. A section in the committed `.taskless/vale/.vale.ini` scoping which files the rule applies to, enabling it as `rules.<id> = YES`.
3. `pass/` and `fail/` fixture documents under `.taskless/vale/rule-tests/<id>/`.

The recipe SHALL state that the scaffolded config carries no section, so the first rule authored in a project also authors the first scope.

#### Scenario: Authoring produces all three artifacts

- **WHEN** the agent follows `create-vale-rule`
- **THEN** it writes the style file, a scoping section enabling the rule, and both fixture buckets

#### Scenario: The recipe teaches the first section

- **WHEN** a project's `.vale.ini` has no section yet
- **THEN** the recipe SHALL direct the agent to add one scoped to the files the rule is about, rather than assuming a section exists

#### Scenario: An unscoped rule is not silently accepted

- **WHEN** the agent enables a rule without placing it inside a section
- **THEN** the recipe SHALL identify this as incomplete, because Vale ignores a rule assignment outside a section

### Requirement: Authoring recipes write files rather than invoking a writer

The `create-*-rule` recipes SHALL instruct the agent to write the rule, its configuration, and its fixtures directly. The CLI SHALL NOT provide a command that generates a Vale style file or edits `.vale.ini` on the agent's behalf.

This matches how ast-grep rules are authored today: the agent writes the rule and its config entry, and construction belongs to the downstream generator rather than to the CLI.

#### Scenario: No CLI writer for Vale configuration

- **WHEN** an agent authors a Vale rule
- **THEN** it edits `.vale.ini` itself
- **AND** the CLI SHALL NOT offer a subcommand that performs that edit

### Requirement: The runtime authoring recipe is the logged-out path

The `create-runtime-rule` recipe SHALL explain that runtime rules execute code and therefore require login, reconciliation, and signing, SHALL state this as a property of executing code rather than of the engine's capability, and SHALL say how to obtain access.

It SHALL NOT forward the agent to another authoring recipe. A logged-in runtime request is routed to `create-remote-rule` by `route`, so this recipe is reached only when the gate is closed and exists to explain that one gate once.

#### Scenario: The gate is explained where it is encountered

- **WHEN** an agent follows `create-runtime-rule`
- **THEN** the recipe SHALL state why the runtime tier is gated when the static tiers are not
- **AND** it SHALL state how to obtain access

#### Scenario: The recipe does not delegate

- **WHEN** an agent follows `create-runtime-rule`
- **THEN** it SHALL NOT be directed to fetch another authoring recipe to proceed

### Requirement: Service generation is one recipe

The CLI SHALL provide a single `create-remote-rule` recipe covering both the client-side boundary of service generation and the procedure itself — enriching the user's description, dispatching to the Taskless service, and reporting the result.

Split across a boundary statement and a procedure, an agent fetches one only to learn it needs the other, which is the second fetch this change exists to remove.

#### Scenario: One fetch reaches the whole procedure

- **WHEN** an agent follows `create-remote-rule`
- **THEN** the recipe SHALL carry both the boundary and the dispatch procedure
- **AND** it SHALL NOT require fetching a second topic to complete the request
