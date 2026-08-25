## MODIFIED Requirements

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
- **The `limit` common field and the per-check `vocab` field**, which the recipe's field table omits. `vocab` SHALL NOT be presented as a field every check accepts: measured, five of the twelve reject it and raise `E201`.

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

## ADDED Requirements

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
