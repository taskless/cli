## ADDED Requirements

### Requirement: Onboarding uses only shipped rules from installed packages

When onboarding sends a candidate to a legacy destination, the recipe SHALL limit the agent to enabling or configuring a rule that the linter, or a plugin package the repository already has installed, already ships. Onboarding SHALL NOT write a custom rule in any linter, regardless of how many custom rules the repository has, and SHALL NOT add a dependency.

A candidate that no installed rule solves SHALL continue down the `route` ladder to a Taskless rule, or to the report's `cloud` tier when only a runtime rule could solve it.

#### Scenario: A plugin that is not installed is not added

- **WHEN** the best existing rule for a candidate belongs to a plugin the repository does not depend on
- **THEN** onboarding SHALL NOT add that plugin
- **AND** the candidate SHALL continue to a Taskless destination

#### Scenario: Custom-rule examples do not unlock authoring during onboarding

- **WHEN** the repository has five or more custom ESLint rules AND no shipped rule solves a candidate
- **THEN** onboarding SHALL NOT write a custom ESLint rule for it
