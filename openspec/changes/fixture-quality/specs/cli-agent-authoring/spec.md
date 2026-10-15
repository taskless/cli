## ADDED Requirements

### Requirement: Fixtures are real, repo-idiomatic code that varies only where the rule looks

Every authoring recipe in which the agent writes or extends fixtures SHALL instruct the agent to:

1. Take fixtures from real code in the repository, trimmed down to the case, before inventing any. An invented fixture is allowed only when the repository has no instance of the case, and the agent's report SHALL say which fixtures were invented.
2. Read the repository's detected linters before writing fixtures. The agent reuses `detect --json` output already in hand, or runs it otherwise. It writes `pass`/`valid` fixtures that those linters, as configured, would accept.
3. Keep every fixture, in both buckets, in the repository's idiom everywhere except the construct the rule checks. A fixture SHALL NOT use placeholder types, catch-all types, or nesting that the repository's own conventions would reject.

A recipe through which the agent submits cases to the generator, instead of writing fixtures itself, SHALL apply the same three instructions to the cases and references it submits.

Fixtures are read as examples of the repository's style. A `valid:` case that the repository's own linter rejects reads as Taskless approving bad code, and a reader who sees that stops trusting the rule before checking what it actually matches.

Enforcing this is the recipe's job. `verify` SHALL NOT lint fixtures and SHALL NOT fail a rule over fixture style.

#### Scenario: Real instances are used before invented ones

- **WHEN** an agent follows an authoring recipe and the repository contains code exhibiting the case
- **THEN** the recipe SHALL direct the agent to take that fixture from the repository rather than inventing one

#### Scenario: Invented fixtures are disclosed

- **WHEN** the repository has no instance of a case and the agent invents a fixture for it
- **THEN** the recipe SHALL direct the agent to name the invented fixtures in its report

#### Scenario: Detected linters shape the passing bucket

- **WHEN** `detect --json` reports one or more linters
- **THEN** the recipe SHALL direct the agent to read each one's configuration before writing fixtures
- **AND** to write `pass`/`valid` fixtures those linters would accept

#### Scenario: Detection is not repeated when routing already ran it

- **WHEN** the agent already has `detect --json` output from routing in the same task
- **THEN** the recipe SHALL let the agent reuse it rather than run detection again

#### Scenario: A fixture varies only on the rule's axis

- **WHEN** the agent writes a near-miss `pass` fixture next to a `fail` fixture
- **THEN** the recipe SHALL direct that the two differ only in the construct the rule checks

#### Scenario: Placeholder types are not used to make a fixture compile

- **WHEN** a fixture needs a type, value, or call that is not what the rule checks
- **THEN** the recipe SHALL direct the agent to use one the repository itself would use, not a placeholder or catch-all type

#### Scenario: Submitted cases meet the same bar

- **WHEN** an agent builds a generation or improvement request for the service
- **THEN** the recipe SHALL apply the same sourcing, linter, and idiom instructions to the submitted cases and references

#### Scenario: verify does not judge fixture style

- **WHEN** `verify` runs a rule whose `pass` fixture would fail the repository's linter
- **THEN** `verify` SHALL report on the rule's behavior alone, and SHALL NOT fail the rule over that fixture's style
