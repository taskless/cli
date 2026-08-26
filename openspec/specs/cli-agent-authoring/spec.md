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

The recipe SHALL additionally carry the guidance below. Each item is a failure observed while authoring rules against this repository, and each produced a rule that passed `verify` and `test` while reporting nothing:

- **What each `scope` reaches**, as measured: `text` sees prose, `code` sees inline code spans, `[code, text]` sees both, and `raw` sees prose, inline code, and fenced blocks. `raw` subsumes the other two.
- **That `scope` is per-rule.** Vale assembles one config per run, which invites the assumption that scopes interact. They do not.
- **That a rule scoped to `raw` cannot be suppressed** by Vale's `<!-- vale Rule = NO -->` directive, because it reads the unparsed document. A rule about a command needs `raw`, so it trades away per-case exemption.
- **That a token made only of punctuation needs `nonword: true`**, because Vale wraps every token in word boundaries.
- **How to scope a rule out**, not only in: a second matcher assigning `<id>.<id> = NO`.
- **That a bare word finds senses you did not mean**, and that narrowing to a collocation is checked by writing the `pass/` fixture from the literal sense first.
- **That fixture design follows the rule's subject**: when the subject normally appears in code, the `fail/` fixture SHALL contain it inline, fenced, and in prose.
- **The `limit` and `vocab` common fields**, which the recipe's field table omits.

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

#### Scenario: A rule about a command reaches fenced blocks

- **WHEN** the agent authors a rule whose subject is a command, flag, or package name
- **THEN** the recipe SHALL direct it to a scope that reaches fenced blocks
- **AND** the `fail/` fixture SHALL carry the subject inline, fenced, and in prose

#### Scenario: A punctuation token is not left unable to match

- **WHEN** the agent authors a rule whose token contains no word characters
- **THEN** the recipe SHALL direct it to set `nonword: true`

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

### Requirement: An authoring recipe states the failure a rule cannot report itself

An authoring recipe SHALL document the ways a rule of its engine can be well formed, enabled, green on its fixtures, and still report nothing.

A malformed rule is caught by `verify` and needs no recipe. A rule that is merely _wrong_ is caught by nothing, ships green, and is discovered only when someone notices it has never fired — so the recipe is the only place that failure can be prevented.

#### Scenario: The recipe names the silent failures for its engine

- **WHEN** an authoring recipe is written or revised
- **THEN** it SHALL name the failures that pass every local gate for that engine
- **AND** each SHALL be stated as an observed behavior of the pinned engine rather than as a caution in principle

#### Scenario: Passing fixtures are not presented as proof of reach

- **WHEN** the recipe directs the agent to run `test`
- **THEN** it SHALL state that fixtures run under an isolating config
- **AND** that a clean `check` SHALL be confirmed against a real file before the rule is believed to be working

### Requirement: The remote authoring recipe guards the GitHub-owner constraint itself

The remote generation recipe SHALL state the GitHub-owner requirement as a precondition it checks, independently of `route`. The guard exists because an agent can reach the recipe directly, from a cached plan, or from a stale copy of the routing guidance, and an advisory omission upstream is not a constraint at the point of use.

#### Scenario: The recipe is reached directly

- **WHEN** an agent fetches the remote generation recipe without going through `route`
- **THEN** the recipe SHALL instruct it to confirm a GitHub owner is identifiable before collecting inputs
- **AND** it SHALL name the local authoring path to use when one is not

#### Scenario: The recipe documents the codes it can raise

- **WHEN** the recipe's `## Errors` section is read
- **THEN** it SHALL list every code the three no-remote populations can produce
