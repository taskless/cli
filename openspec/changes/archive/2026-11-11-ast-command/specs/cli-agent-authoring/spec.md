## ADDED Requirements

### Requirement: The ast-grep authoring recipe sends kind lookups to the ast command

`create-sg-rule` SHALL tell the author to read every `kind:` off `taskless ast <file>` run on a file the rule targets, and SHALL name its `--range`, `--lang` and `--json` options. It SHALL NOT direct the author to run ast-grep's `--debug-query` or to locate an ast-grep binary. The `sg-regex-needs-kind` message from `validate` SHALL name the same command as where to find a kind to add.

#### Scenario: The recipe names the command

- **WHEN** an agent runs `taskless agent create-sg-rule`
- **THEN** the recipe SHALL contain an invocation of `ast <file>`
- **AND** it SHALL NOT contain `--debug-query`
