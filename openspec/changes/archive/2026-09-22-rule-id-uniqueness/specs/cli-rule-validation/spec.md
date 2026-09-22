## ADDED Requirements

### Requirement: Verify refuses a rule id held by more than one engine

`verify` SHALL fail a rule whose id is also a directory name under another engine, and the failure SHALL name every engine directory holding the id and the `.taskless/rule-metadata/<id>.yml` sidecar they share, and SHALL say to rename one of them. `test` SHALL inherit the refusal, because `test` runs `verify` first.

The check SHALL be made per rule, not only over the whole project. `verify` is invoked on a single rule as well as on the tree, and verifying the rule an author has just written is the moment the collision is cheapest to fix; a project-wide pass that only diffs the per-engine id lists reports nothing at exactly that moment. The project-wide form follows from running the per-rule check for each rule.

The condition SHALL be described the way `rules delete` already describes it, which refuses the same state under `RULE_ID_AMBIGUOUS`. One condition described in two vocabularies is how a reader comes to believe it is two conditions.

The failure SHALL NOT be attributed to a published `RULE_CONSTRAINTS` entry. Every constraint is declared for one engine and published per engine, because a constraint states what this CLI requires of a rule for that engine beyond what the engine itself requires. A collision requires nothing of the rule: the file is valid, and what is wrong is that a sibling tree holds the same directory name.

The write path SHALL NOT refuse. `check`'s repair path calls `writeRuleFile`, so refusing there would leave both colliding rules unrepairable, which is worse than the silence it would replace. A warning after the write is the write path's whole contribution.

#### Scenario: A colliding pair fails from either side

- **WHEN** `no-eval` exists under two engines and `verify` runs against either one
- **THEN** the rule SHALL fail
- **AND** the failure SHALL name both engine directories

#### Scenario: Verifying one rule catches a collision with another engine

- **WHEN** `verify` runs against a single rule whose id is also held by another engine
- **THEN** it SHALL report the collision without being run over the whole tree

#### Scenario: A tree with no collision passes

- **WHEN** every rule id in the project is held by exactly one engine
- **THEN** `verify` SHALL report no collision for any rule

#### Scenario: The collision carries no constraint id

- **WHEN** `verify --json` reports a collision
- **THEN** the message SHALL appear in `errors`
- **AND** no violation SHALL be reported for it

#### Scenario: Writing a colliding rule warns rather than refusing

- **WHEN** a rule is written whose id another engine already holds
- **THEN** the rule SHALL be written
- **AND** the caller SHALL receive a warning naming both directories

## MODIFIED Requirements

### Requirement: Rules are validated and tested by path, not by id

The CLI SHALL provide `verify <path>` and `test <path>`. Both SHALL accept a path to a rule's canonical location or to any directory above it, and SHALL resolve the owning engine from the path's position under `.taskless/rules/<engine>/` rather than by parsing the file.

An id does not name one thing. The same id can exist under `sg` and under `vale`, so an id-addressed command has to either guess or report an ambiguity; a path has neither problem. Resolving the engine from position — never from content — is the same rule dispatch follows, so a rule cannot be validated by one engine and executed by another.

Addressing a rule by path is what removes the ambiguity from the COMMAND. It does not make the project's layout correct: the two rules still share one metadata sidecar, and `verify` reports that as a failure of each rule. The two are separate answers to separate questions, and neither replaces the other.

#### Scenario: A rule path resolves to its engine

- **WHEN** `verify .taskless/rules/vale/no-simply` is run
- **THEN** the CLI SHALL validate it as a Vale rule

#### Scenario: The same id under two engines is not ambiguous

- **WHEN** `no-simply` exists under both `rules/sg/` and `rules/vale/`
- **THEN** each is addressed by its own path
- **AND** neither command SHALL require the user to disambiguate
- **AND** each rule SHALL still be reported as failing verification, because the id is held by two engines

#### Scenario: A directory means everything beneath it

- **WHEN** `verify .taskless/` is run
- **THEN** every rule beneath it SHALL be validated, each against its own engine
- **AND** the command SHALL report per-rule results rather than a single pass or fail

#### Scenario: A path outside any engine's rules directory is rejected

- **WHEN** a path resolves to no engine
- **THEN** the CLI SHALL exit non-zero naming the path, rather than guessing an engine
