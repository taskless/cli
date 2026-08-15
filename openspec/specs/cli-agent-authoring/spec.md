# cli-agent-authoring Specification

## Purpose
TBD - created by archiving change agent-command-and-vale-authoring. Update Purpose after archive.
## Requirements
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

1. A Vale style file at `.taskless/rules/vale/<id>/<id>.yml`.
2. That rule's own `.taskless/rules/vale/<id>/.vale.ini`, declaring the matchers that scope it and enabling it as `<id>.<id> = YES`.
3. `pass/` and `fail/` fixture documents under `.taskless/rules/vale/<id>/.tests/`.

The recipe SHALL state that scope is declared in the rule's own config, that no shared file is edited, and that the project-wide config is assembled rather than authored.

It SHALL direct the agent to check its work by running `verify` and then `test` against the rule's directory path.

The previous version of this requirement taught the agent to add a matcher to a single project-wide `.vale.ini`. Executing that recipe against sandboxed agents found every one of its silent failures in that step and nowhere else — an assignment above the first matcher, a glob that missed the fixture extension, three names that had to agree with nothing reporting when they didn't. The layout change removes the step rather than documenting it further.

#### Scenario: Authoring produces all three artifacts

- **WHEN** the agent follows `create-vale-rule`
- **THEN** it writes the style file, the rule's own config with a scoping matcher, and both fixture buckets

#### Scenario: No shared file is edited

- **WHEN** the agent scopes a rule
- **THEN** it writes matchers into that rule's own config
- **AND** it SHALL NOT be directed to edit a project-wide Vale config

#### Scenario: The recipe names the commands that check the work

- **WHEN** the agent has written the three artifacts
- **THEN** the recipe SHALL direct it to run `verify` and `test` against the rule's path

#### Scenario: An unscoped rule is not silently accepted

- **WHEN** the agent writes a style file without a matcher enabling it in the rule's own config
- **THEN** the recipe SHALL identify this as incomplete
- **AND** `verify` SHALL report it

### Requirement: Authoring recipes write files rather than invoking a writer

The `create-*-rule` recipes SHALL instruct the agent to write the rule, its configuration, and its fixtures directly. The CLI SHALL NOT provide a command that generates a Vale style file or authors a rule's matchers on the agent's behalf.

Assembling the run config is not an exception to this. The agent authors every committed file, including the rule's own `.vale.ini`; assembly only concatenates what the agent wrote into the single file Vale's `--config` requires, and adds no scoping decision of its own.

#### Scenario: No CLI writer for rule configuration

- **WHEN** an agent authors a Vale rule
- **THEN** it writes that rule's `.vale.ini` itself
- **AND** the CLI SHALL NOT offer a subcommand that authors matchers

#### Scenario: Assembly makes no scoping decisions

- **WHEN** the run config is assembled
- **THEN** it SHALL contain only matchers the agent authored, in the order they were authored

### Requirement: The runtime authoring recipe is the logged-out path

The `create-runtime-rule` recipe SHALL explain that runtime rules execute code and therefore require login, reconciliation, and signing, and SHALL state this as a property of executing code rather than of the engine's capability. It SHALL point at `auth` for obtaining access rather than restating the login procedure, which `auth` owns.

It SHALL NOT forward the agent to another authoring recipe. A logged-in runtime request is routed to `create-remote-rule` by `route`, so this recipe is reached only when the gate is closed and exists to explain that one gate once.

#### Scenario: The gate is explained where it is encountered

- **WHEN** an agent follows `create-runtime-rule`
- **THEN** the recipe SHALL state why the runtime tier is gated when the static tiers are not
- **AND** it SHALL refer the reader to `auth` rather than restating how to log in

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

### Requirement: Every authoring recipe opens by orienting the reader

Each `create-*-rule` recipe SHALL open with a line naming the topic the reader is in, the kinds of rule it helps write, and an instruction to revisit the routing decision if that is not what they need.

The line SHALL orient, not classify: it states this recipe's own scope and SHALL NOT restate the criterion distinguishing the engines from each other, which `route` holds in one place. An agent that arrived at the wrong recipe — by guessing, by a user naming a topic directly, or because `route` was wrong — should discover it in the first line, where recovery is cheap, rather than after authoring the wrong artifact.

#### Scenario: A misrouted reader is told how to recover

- **WHEN** an agent opens any `create-*-rule` recipe
- **THEN** the first lines SHALL name what that recipe helps write
- **AND** SHALL instruct the agent to revisit its routing decision if it needs a different kind of check

#### Scenario: The orientation is not a second criterion

- **WHEN** the orientation line is read
- **THEN** it SHALL describe only this recipe's scope, not the comparison between engines

