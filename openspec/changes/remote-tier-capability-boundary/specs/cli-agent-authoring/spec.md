## ADDED Requirements

### Requirement: The remote authoring recipe guards the GitHub-owner constraint itself

The remote generation recipe SHALL state the GitHub-owner requirement as a precondition it checks, independently of `route`. The guard exists because an agent can reach the recipe directly, from a cached plan, or from a stale copy of the routing guidance, and an advisory omission upstream is not a constraint at the point of use.

#### Scenario: The recipe is reached directly

- **WHEN** an agent fetches the remote generation recipe without going through `route`
- **THEN** the recipe SHALL instruct it to confirm a GitHub owner is identifiable before collecting inputs
- **AND** it SHALL name the local authoring path to use when one is not

#### Scenario: The recipe documents the codes it can raise

- **WHEN** the recipe's `## Errors` section is read
- **THEN** it SHALL list every code the three no-remote populations can produce
