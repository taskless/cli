## ADDED Requirements

### Requirement: The Vale grammar resolver is published beside the binary resolver

The runtimes entry SHALL publish the resolver the CLI uses to locate the pinned Vale grammar directory, together with the grammar package's spec, from the same modules the CLI dispatches on.

A consumer that verifies a Vale rule over source code has to run it with the grammars the CLI runs it with: without them Vale reads comments by delimiters and reports different findings for the same rule. Publishing the resolver makes the grammar version a consequence of the CLI pin, as the binary version already is.

Resolution SHALL report a miss as a value, returning an absent path alongside the locations searched, and SHALL NOT throw, for the reason the binary resolver does: each caller decides whether a miss is fatal.

#### Scenario: A consumer runs Vale with the CLI's grammars

- **WHEN** a consumer imports the runtimes entry and resolves the grammar directory
- **THEN** it SHALL receive the absolute path of the directory the CLI names to Vale
- **AND** the resolver SHALL be the module the CLI itself uses, not a copy kept in step

#### Scenario: The grammar package does not resolve

- **WHEN** the grammar package is not installed
- **THEN** resolution SHALL return an absent path and the locations it searched
- **AND** it SHALL NOT throw
