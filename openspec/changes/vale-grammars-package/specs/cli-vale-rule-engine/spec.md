## ADDED Requirements

### Requirement: Vale reads source code with the pinned grammars

Every Vale invocation the CLI makes, for `check` and for `verify`, SHALL name the directory of the pinned grammar package as Vale's grammar directory. Vale reads that directory for any grammar its StylesPath does not hold.

Every comment-tier extension the CLI lists SHALL be covered: run against the pinned binary with the pinned grammars, no listed extension SHALL produce a warning that its grammar is not installed. A listed extension Vale reads by delimiters with no grammar at all, as it did before grammars were separate, is not a gap.

When the grammar package cannot be resolved, Vale SHALL still run, and its warnings that a grammar is not installed SHALL reach the user as notices, as any other zero-exit diagnostic does.

#### Scenario: A directive comment is not linted as prose

- **WHEN** a rule over comments runs on a Go file whose first line is `//nolint:simply` and whose second line is `// simply here`
- **THEN** the rule SHALL report line 2 and SHALL NOT report line 1

#### Scenario: A one-line CSS block comment is linted

- **WHEN** a rule over comments runs on a CSS file containing `/* simply here */`
- **THEN** the rule SHALL report that line

#### Scenario: No grammar warning on a covered extension

- **WHEN** `check` runs Vale over a file with any comment-tier extension the CLI lists
- **THEN** Vale SHALL write no warning that a grammar is not installed, and the result SHALL carry no such notice

#### Scenario: An extension needing an unshipped grammar fails the contract

- **WHEN** a comment-tier extension is listed whose grammar the pinned grammar package does not carry
- **THEN** the vendor contract SHALL fail, naming the extension and the grammar

### Requirement: A grammar directory in the Vale rules tree is refused

The Vale rules tree is the StylesPath of every assembled config, and Vale reads a grammar from the StylesPath in preference to the pinned grammar directory. The system SHALL therefore refuse a grammar directory inside the Vale rules tree, whatever it contains, because its grammars were not shipped or pinned by the CLI.

The refusal SHALL be made where the Vale config is assembled, so that `validate` and `check` both refuse it. Under `check` it SHALL refuse the Vale engine as a rejected rule config does: the engine reports a failure naming the directory, the failure reaches the exit code, and other engines still run.

#### Scenario: validate refuses an unvetted grammar directory

- **WHEN** `.taskless/rules/vale/config/grammars/` exists and `validate` runs
- **THEN** `validate` SHALL report a failure naming that directory and SHALL exit non-zero

#### Scenario: check refuses the Vale engine over an unvetted grammar directory

- **WHEN** `.taskless/rules/vale/config/grammars/` exists and `check` runs
- **THEN** the Vale engine SHALL report a failure naming that directory without running Vale
- **AND** the exit code SHALL be non-zero
- **AND** ast-grep results for the same run SHALL still be reported

#### Scenario: A grammar directory elsewhere is not the CLI's concern

- **WHEN** the project's own Vale StylesPath, outside the Vale rules tree, holds grammars from a user's `vale sync`
- **THEN** `validate` and `check` SHALL neither refuse nor read them
