## MODIFIED Requirements

### Requirement: The Vale authoring recipe covers rule, scope, and fixtures

The `create-vale-rule` recipe SHALL instruct the agent to produce three artifacts, and SHALL state that a rule is incomplete without all three:

1. A Vale style file at `.taskless/rules/vale/<id>/<id>.yml`.
2. That rule's own `.taskless/rules/vale/<id>/.vale.ini`, declaring the matchers that scope it and enabling it as `<id>.<id> = YES`.
3. Fixture case directories under `.taskless/rules/vale/<id>/tests/pass/` and `tests/fail/`, laid out as the shared fixture section describes.

The recipe SHALL state that scope is declared in the rule's own config, that no shared file is edited, and that the project-wide config is assembled rather than authored.

It SHALL direct the agent to check its work by running `validate` and then `verify` against the rule's directory path.

The previous version of this requirement taught the agent to add a matcher to a single project-wide `.vale.ini`. Executing that recipe against sandboxed agents found every one of its silent failures in that step and nowhere else — an assignment above the first matcher, a glob that missed the fixture extension, three names that had to agree with nothing reporting when they didn't. The layout change removes the step rather than documenting it further.

The recipe SHALL additionally carry the guidance below. Each item is a failure observed while authoring rules against this repository, and each produced a rule that passed `validate` and `verify` while reporting nothing:

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
- **THEN** the recipe SHALL direct it to run `validate` and `verify` against the rule's path

#### Scenario: An unscoped rule is not silently accepted

- **WHEN** the agent writes a style file without a matcher enabling it in the rule's own config
- **THEN** the recipe SHALL identify this as incomplete
- **AND** `validate` SHALL report it

#### Scenario: A rule about a command reaches fenced blocks

- **WHEN** the agent authors a rule whose subject is a command, flag, or package name
- **THEN** the recipe SHALL direct it to a scope that reaches fenced blocks
- **AND** the `fail/` fixture SHALL carry the subject inline, fenced, and in prose

#### Scenario: A punctuation token is not left unable to match

- **WHEN** the agent authors a rule whose token contains no word characters
- **THEN** the recipe SHALL direct it to set `nonword: true`

## ADDED Requirements

### Requirement: Authoring recipes share one fixture section

Every recipe in which the agent writes or extends fixtures (`create-sg-rule`, `create-vale-rule`, `create-runtime-rule`, `improve-rule` and `validate-rule`) SHALL direct the agent to one shared fixture section and SHALL NOT carry its own copy of the layout. The shared section SHALL state:

1. The layout: `tests/pass/<case>/` and `tests/fail/<case>/`, with the case directory named for what the case shows.
2. That a case is judged by the engine's own check with the case directory as the root, so a fixture for a scoped rule places its files at a path the scope accepts. For example, an ast-grep rule scoped to `.github/workflows/*.yml` needs `tests/fail/<case>/.github/workflows/ci.yml`.
3. That a `fail/` case needs one finding and a `pass/` case none, and that nothing about position, message, or count is asserted.
4. What a "scope excluded this case" failure means, and that the fix is the fixture's path or the scope, not the pattern.

A per-engine recipe SHALL keep only what is that engine's own, such as Vale's scope reach and the fact that a runtime case is the check's root.

**Rationale.** The fixture contract is now one contract. Three copies of it would drift the way the three fixture readers did, and the path rule for scoped rules is the one new thing authors have to learn. It belongs where every recipe reaches it.

#### Scenario: Every authoring recipe reaches the same fixture guidance

- **WHEN** the agent follows any recipe that writes fixtures
- **THEN** the recipe SHALL direct it to the shared fixture section
- **AND** SHALL NOT restate the layout in its own words

#### Scenario: A scoped rule's fixture path is taught

- **WHEN** the agent writes fixtures for a rule that declares `files:` or Vale matchers
- **THEN** the shared section SHALL direct it to place each case's files at a path the scope accepts
