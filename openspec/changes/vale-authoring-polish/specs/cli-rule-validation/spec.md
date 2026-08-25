## MODIFIED Requirements

### Requirement: Verify checks a rule's required components

`verify` SHALL check that a rule has the components its engine requires and that they are well formed, and SHALL NOT require fixtures or test cases to exist.

The two commands split because they have different preconditions. An agent part-way through authoring has a rule and no fixtures yet, and needs to know the rule itself is valid before it can write a meaningful test for it.

Per engine, `verify` SHALL check:

| Engine    | Components                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `sg`      | `<id>.yml` against the ast-grep schema and the Taskless required fields                              |
| `vale`    | `<id>.yml` against the Vale rule schema and the Taskless required fields, and the rule's `.vale.ini` |
| `runtime` | `check.ts` present, and at least one capture rule under `captures/`                                  |

The `vale` row previously read "against Vale's own validation." Measured against the pinned 3.18.0 binary, that covers less than it claims: `level: bananas` is reported, while `extends: nonsense` and `scope: fenced` both verify clean and produce a rule that matches nothing. Vale validates a rule when it _runs_ one, and it runs one field at a time — so a name it does not recognize is not an error, it is a check that never fires. Schema validation is therefore its own layer for `vale`, as it already is for `sg`.

#### Scenario: A rule with no fixtures still verifies

- **WHEN** `verify` runs against a rule whose fixture buckets are empty or absent
- **THEN** it SHALL report on the rule's components only
- **AND** the absence of fixtures SHALL NOT be a verify failure

#### Scenario: A malformed rule reports its own error

- **WHEN** a Vale style declares a `level` outside `suggestion`/`warning`/`error`
- **THEN** `verify` SHALL report that error, naming the field

#### Scenario: An unrecognized extension point is rejected

- **WHEN** a Vale style declares an `extends` that is not one of Vale's check types
- **THEN** `verify` SHALL report it, naming the field and the accepted values
- **AND** it SHALL NOT report the rule as valid

#### Scenario: An unrecognized scope is rejected

- **WHEN** a Vale style declares a `scope` that is not one of Vale's scope values
- **THEN** `verify` SHALL report it, naming the field
- **AND** a scope using the `~` negation or `&` chaining syntax over recognized values SHALL be accepted

#### Scenario: A field belonging to another check type is rejected

- **WHEN** a Vale style declares a field its `extends` does not accept, such as `tokens` on an `occurrence` check
- **THEN** `verify` SHALL report it before Vale is invoked

The failure it prevents is not a local one: Vale reports this as `E201: has invalid keys` and reads one assembled config per run, so a single rule with a stray field suppresses every other Vale rule's findings.

## ADDED Requirements

### Requirement: The Vale rule schema is pinned to the vendored binary

The Vale rule schema SHALL be authored in this repository and pinned to `VALE_VERSION`, and a vendor-contract test SHALL hold its claims against the vendored binary.

Vale publishes no JSON Schema for its check types. The machine-readable field knowledge exists only behind its hosted MCP server, which is a paid product and unavailable to `verify`. The schema is therefore a transcription, and a transcription drifts — so the binary, not the documentation, SHALL be the authority for what the schema asserts.

#### Scenario: A Vale upgrade that invalidates the schema fails loudly

- **WHEN** `VALE_VERSION` is raised to a version whose accepted check types or scopes differ from the schema
- **THEN** the vendor-contract test SHALL fail
- **AND** the failure SHALL name the field whose accepted values changed

#### Scenario: The schema is not derived from documentation alone

- **WHEN** a value is added to the schema's `extends` or `scope` enumerations
- **THEN** it SHALL be one the vendored binary was measured accepting
