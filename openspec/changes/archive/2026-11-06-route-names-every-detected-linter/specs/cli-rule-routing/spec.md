## MODIFIED Requirements

### Requirement: Route describes each detected linter

The `route` recipe SHALL include, for each linter `detect` reports that can host a legacy rule, one paragraph saying what the tool is for, what the agent always checks first in it, and the recipe command to fetch for it. The paragraphs SHALL be rendered when the recipe is served, and SHALL appear only for linters detected in the repository.

A detected tool that can host a legacy rule and has no paragraph SHALL be named in the recipe with the command to fetch the generic recipe for it, and the recipe SHALL state that steps 1 and 2 of the legacy ladder still apply to it. `route` SHALL NOT state or imply that a linter `detect` reported is absent. Formatters and Taskless's own engines are not legacy hosts and SHALL NOT be named this way.

When the recipe is rendered from a scan, it SHALL state that `detect` recognizes a fixed list of tools, so the repository may run others.

#### Scenario: Only detected linters are described

- **WHEN** `detect` reports Ruff and no other linter
- **THEN** the served `route` recipe SHALL contain the Ruff paragraph
- **AND** SHALL NOT contain a paragraph for any other linter

#### Scenario: A tool with no legacy recipe gets no paragraph

- **WHEN** `detect` reports only `prettier`
- **THEN** the served `route` recipe SHALL contain no linter paragraph

#### Scenario: Oxlint is described when detected

- **WHEN** `detect` reports `oxlint` and no other linter
- **THEN** the served `route` recipe SHALL contain the Oxlint paragraph
- **AND** SHALL NOT say that no linter was found

#### Scenario: A detected linter with no paragraph is still named

- **WHEN** `detect` reports `eslint` and `stylelint`
- **THEN** the served `route` recipe SHALL contain the ESLint paragraph
- **AND** SHALL name `stylelint` with the command to fetch `create-legacy-rule` for it

#### Scenario: A formatter is not offered as a legacy destination

- **WHEN** `detect` reports `eslint` and `prettier`
- **THEN** the served `route` recipe SHALL NOT name `prettier` as a linter to fetch a recipe for
