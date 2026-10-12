## MODIFIED Requirements

### Requirement: Static recipe authors a verified local ast-grep rule

The CLI SHALL provide a `create-sg-rule` help recipe that instructs the agent to author a
local ast-grep rule on-device, without calling the Taskless service, and to
verify it against the user's success and failure cases before reporting success.
The recipe SHALL produce the canonical on-disk rule shape and paths used by remote
generation so that `check`, `improve`, and `validate` see a single dialect.

The recipe SHALL be named for the artifact it produces rather than for a trust tier. "Static" describes when a rule runs, which is a different axis from which engine enforces it, and naming the ast-grep authoring path after the tier taught the conflation that engine selection exists to correct.

#### Scenario: Local authoring without the service

- **WHEN** the agent follows `create-sg-rule`
- **THEN** it SHALL write the rule on-device without requiring login or the
  Taskless API
