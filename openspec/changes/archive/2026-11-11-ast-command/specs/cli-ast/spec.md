## ADDED Requirements

### Requirement: The ast command prints a file's named-node AST

The CLI SHALL provide `taskless ast <file>`, which prints the named-node syntax tree of one file as the ast-grep bundled with the CLI parses it. It SHALL print named nodes only, so that every kind it shows is one a rule's `kind:` accepts. Each node SHALL carry its kind, the field it fills in its parent when the grammar names one, and its start and end as a 1-based line and a 0-based byte column. A node with no named children SHALL carry its source text. The command SHALL read the file and write nothing, and SHALL NOT require `.taskless/` to exist. It SHALL accept `--dir`/`-d`, against which a relative file path resolves.

#### Scenario: A file is dumped by its extension

- **WHEN** `taskless ast src/a.ts` is run on a file holding `const a = 1;`
- **THEN** the output SHALL name the language `TypeScript`
- **AND** it SHALL list `lexical_declaration`, `variable_declarator` and `name: identifier` with their positions
- **AND** it SHALL NOT list the `const` keyword as a node

#### Scenario: JSON output

- **WHEN** `taskless ast <file> --json` succeeds
- **THEN** stdout SHALL be one JSON object with `ok: true`, `file`, `language`, `errorNodes` and a nested `root` node
- **AND** `errorNodes` SHALL count the `ERROR` nodes in the whole tree, so a file that did not parse cleanly as that language is visible

### Requirement: The ast command uses check's language resolution

Without `--lang`, the command SHALL parse the file as the language the bundled ast-grep assigns its path, asked of the binary rather than of a table in the CLI, and SHALL NOT apply the `languageGlobs` of an `sgconfig.yml` found above the working directory, since `check` does not. `--lang` SHALL take any spelling a rule's `language:` accepts and parse as the language it resolves to.

#### Scenario: An extension ast-grep does not recognize

- **WHEN** `taskless ast notes.unknownext --json` is run
- **THEN** stdout SHALL be an `INVALID_INPUT` envelope that says the extension is not recognized and lists the languages `--lang` accepts
- **AND** the exit code SHALL be 1

#### Scenario: A language override

- **WHEN** `taskless ast list.txt --lang yaml` is run
- **THEN** the file SHALL be parsed as `Yaml`

### Requirement: The ast command can cut the tree to a line range

`--range <line>` or `--range <from>:<to>`, 1-based and inclusive, SHALL cut the tree to the nodes whose lines overlap the range, keeping the nodes that enclose them. A node that ends at column 0 of a line SHALL NOT count as on that line. A range that no node touches, and a malformed range, SHALL fail with `INVALID_INPUT`.

#### Scenario: One line of a file

- **WHEN** a file's third line is `foo(b);` and `taskless ast <file> --range 3` is run
- **THEN** the root SHALL keep only the `expression_statement` on line 3 among its children

### Requirement: The ast command reports what it cannot dump

The command SHALL fail with the standard `--json` error envelope and exit code 1, and SHALL NOT print a partial tree, when the file is missing, empty or a directory, when `--lang` names no ast-grep language, when the file is too large to hand to ast-grep on this platform (each `INVALID_INPUT`), when no ast-grep binary is found (`ENGINE_UNAVAILABLE`), and when ast-grep prints no tree it can parse (`SCAN_FAILED`).

#### Scenario: A file too large for the command line

- **WHEN** `taskless ast big.js --json` is run on a file past the platform's argument limit
- **THEN** stdout SHALL be an `INVALID_INPUT` envelope saying the file is too large to dump
