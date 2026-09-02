# cli-generated-rule-delivery Specification

## Purpose

TBD - created by archiving change generator-payload-alignment. Update Purpose after archive.

## Requirements

### Requirement: A delivered rule is a file set

The CLI SHALL accept a generated rule as a set of files, each with a path relative to
`.taskless/rules/<engine>/<id>/` and its content as text. One shape SHALL serve every engine,
validated against `ENGINE_LAYOUTS` — the table the CLI already holds — so that "is this a complete
rule" is answered from data rather than from per-engine prose.

A response entry carrying the legacy single `content` object SHALL remain valid and SHALL continue
to be filed as an ast-grep rule. `files` and `content` SHALL be mutually exclusive.

#### Scenario: A runtime rule arrives complete

- **WHEN** a delivered rule declares engine `runtime` and carries `check.ts` and `captures/*.yml`
- **THEN** the CLI SHALL write them under `.taskless/rules/runtime/<id>/`
- **AND** the rule SHALL be discoverable and verifiable without further input

#### Scenario: A Vale rule arrives with its config

- **WHEN** a delivered rule declares engine `vale` and carries `<id>.yml` and `.vale.ini`
- **THEN** the CLI SHALL write both
- **AND** the rule SHALL be scoped by its own `.vale.ini` rather than by a synthesized default

#### Scenario: An incomplete file set is refused

- **WHEN** a delivered file set omits a file the engine layout requires
- **THEN** the CLI SHALL refuse the rule and name what is missing
- **AND** SHALL NOT write a partial rule directory

### Requirement: Delivered paths are refused before they are written

The CLI SHALL reject an absolute path, any `..` segment, and any path the engine layout does not
account for, **before** creating any directory or file. Writing server-supplied paths is a
directory-traversal surface that did not exist while the response carried one structured object
whose destination the client computed itself.

#### Scenario: A traversing path is refused

- **WHEN** a delivered file declares a path containing `..` or an absolute path
- **THEN** the CLI SHALL refuse the entire rule
- **AND** SHALL NOT have created any file or directory for it
