## ADDED Requirements

### Requirement: Vale styles live under the rules StyleName

The system SHALL place Vale styles under `.taskless/vale/rules/` so that `rules` is Vale's StyleName, with `.vale.ini` configured `StylesPath = .` and `BasedOnStyles = rules`. The Vale check identifier `rules.<name>` SHALL be normalized to `ruleId = <name>` in results.

#### Scenario: Style resolution and identity

- **WHEN** a Vale style exists at `.taskless/vale/rules/no-simply.yml`
- **THEN** Vale loads it as `rules.no-simply`, and the CLI reports its findings with `ruleId` `no-simply`
