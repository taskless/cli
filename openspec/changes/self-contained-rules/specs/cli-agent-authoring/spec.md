## MODIFIED Requirements

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
