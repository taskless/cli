## MODIFIED Requirements

### Requirement: The Vale rule schema is pinned to the vendored binary

The Vale rule schema's vocabulary SHALL be derived from the vendored binary by a generator in this repository, written to a checked-in artifact pinned to `VALE_VERSION`, and a differential test SHALL hold the schema's claims against that binary.

Vale publishes no JSON Schema for its check types. The machine-readable field knowledge exists only behind its hosted MCP server, which is a paid product and unavailable to `verify`. The binary, not the documentation, SHALL therefore be the authority for what the schema asserts — and it SHALL be asked by a script that can be re-run, rather than by hand once. What a transcription loses is not the answer but the question: a later reader inherits a value with no way to reproduce the measurement that produced it.

The generator SHALL take every verdict from the process exit status and the structured JSON output, and SHALL NOT take one by matching output against an error phrase. A configuration error is reported on stderr as an object carrying a `Code`; a crash produces no such object at all. A probe that matches on a phrase scores a crash as a clean run, which has already produced a wrong entry in this schema.

Where the derivation rests on a proposed candidate rather than on a set the binary enumerates, that SHALL be recorded as a limit of the artifact. Vale names the key an author got wrong and never the ones they could have used, and an unrecognized scope raises nothing at all — so field tables and scope operands are verified rather than discovered, and a value nobody proposes is absent.

#### Scenario: A Vale upgrade that invalidates the schema fails loudly

- **WHEN** `VALE_VERSION` is raised to a version whose accepted check types, fields, or scopes differ from the artifact
- **THEN** the differential test SHALL fail
- **AND** the failure SHALL name the construct whose treatment changed

#### Scenario: The generator refuses to emit a vocabulary it cannot read

- **WHEN** the binary's enumeration of its own accepted values no longer matches the shape the generator parses
- **THEN** the generator SHALL fail with an error naming what it could not read
- **AND** it SHALL NOT emit a partial enumeration

A short enum is _stricter_ than the binary, so a silent partial parse would begin rejecting rules Vale accepts — blocking work that would have functioned, which is the worse of the two failure directions.

#### Scenario: A divergence from Vale's documentation is reported, not dropped

- **WHEN** the binary's measured behavior disagrees with Vale's published documentation, in either direction
- **THEN** generation SHALL emit that disagreement as part of its output
- **AND** the artifact SHALL record which side the schema followed

A documented value that never fires is a trap an author walks into with the docs open. An undocumented value that works is evidence that something real may be missing from the candidate list. Neither may be resolved silently.

#### Scenario: The vocabulary describes the binary the build ships

- **WHEN** the checked-in artifact records a different Vale version than `VALE_VERSION`
- **THEN** the build SHALL fail
- **AND** the failure SHALL name the two versions

#### Scenario: Behavior a schema cannot express stays explicit

- **WHEN** a rule shape crashes the binary although every key in it is a legal field of its check
- **THEN** the schema SHALL reject that shape through a check stated alongside the generated field tables
- **AND** the rejection SHALL NOT be encoded as a field-table fact
