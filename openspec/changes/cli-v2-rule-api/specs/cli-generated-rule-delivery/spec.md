## MODIFIED Requirements

### Requirement: A delivered rule is a file set

The CLI SHALL accept a rule served by the v2 API (`GET /cli/api/v2/rule/{ruleId}`, restore,
or rollback) as exactly one file set `{ id, engine, files, signatures }`, each file with a path
relative to `.taskless/rules/<engine>/<id>/` and its content as text. One shape SHALL serve every
engine, validated against `ENGINE_LAYOUTS` — the table the CLI already holds — so that "is this a
complete rule" is answered from data rather than from per-engine prose. The legacy single
`content` object is not part of v2 and SHALL NOT be accepted.

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

#### Scenario: A response with more than one rule is refused

- **WHEN** a v2 rule response carries a `rules` array whose length is not exactly one, or whose one set's `id` is not the requested rule id
- **THEN** the CLI SHALL refuse the response and write nothing

### Requirement: A runtime rule written under a plan without runtime signatures says it will not run

When the CLI writes a runtime rule from a response whose `entitlement.runtimeSignatures` is exactly `false` (from `rule create`, `rule improve`, `rule restore`, or `rule rollback`), it SHALL still write the rule, and SHALL emit a warning that the rule is on disk but will not run on the organization's current plan, including the `upgradeUrl` when it is an absolute `https:` URL. The warning SHALL be carried in the command's existing notices, so it appears in human output and under `--json`. A restore or rollback under such a response SHALL NOT state or imply that the next `check` will run the rule. A response with no `entitlement` object, or with `runtimeSignatures: true`, SHALL produce no such warning.

#### Scenario: Created runtime rule under an unentitled plan

- **WHEN** `rule create` receives a generated runtime rule with `entitlement.runtimeSignatures: false`
- **THEN** the CLI SHALL write the rule
- **AND** SHALL warn that it will not run on the current plan
- **AND** under `--json` the warning SHALL appear in `notices`

#### Scenario: Restore under an unentitled plan does not promise blessing

- **WHEN** `rule restore` writes a runtime rule and the restore response carries `entitlement.runtimeSignatures: false`
- **THEN** the notice SHALL say the rule's bytes were restored but will not run on the current plan
- **AND** SHALL NOT say the next `check` runs it

#### Scenario: Entitled or legacy responses do not warn

- **WHEN** a runtime rule is written from a response with no `entitlement` object or with `runtimeSignatures: true`
- **THEN** the CLI SHALL emit no entitlement warning

#### Scenario: Static rules never warn

- **WHEN** `rule create` writes an `sg` or `vale` rule
- **THEN** the CLI SHALL emit no entitlement warning

## ADDED Requirements

### Requirement: A delivered file set is verified against its signatures

Before writing any file of a served rule, the CLI SHALL verify that every signature names a
delivered file, that every delivered file outside `.tests/` has exactly one signature, and that
the algoVersion-1 `canonicalHash` of each such file's content equals its signature. For a
runtime rule it SHALL also verify that the singular `signature` equals the `check.ts` entry.
Any failure SHALL refuse the whole rule and write nothing.

#### Scenario: A corrupted file is refused

- **WHEN** a served file's content does not hash to its entry in `signatures`
- **THEN** the CLI SHALL refuse the rule naming the file
- **AND** SHALL write nothing for it

#### Scenario: An unsigned file is refused

- **WHEN** a served file outside `.tests/` has no entry in `signatures`
- **THEN** the CLI SHALL refuse the rule

#### Scenario: Fixtures need no signature

- **WHEN** a served rule carries files under `.tests/` that have no entry in `signatures`
- **THEN** the CLI SHALL accept them

### Requirement: A delivered rule replaces its directory

After verification, the CLI SHALL write a served rule so that its directory holds exactly the
served files: every file in the directory that the served set does not contain SHALL be removed.
Files under `.tests/` SHALL be replaced only when the served set carries at least one `.tests/`
file; otherwise the local `.tests/` SHALL be left in place. When a stale file cannot be removed, the CLI SHALL say that the served
bytes were written and name each entry it could not remove.

#### Scenario: A local extra file does not survive

- **WHEN** a rule directory holds `captures/extra.yml` and the served set does not
- **THEN** after the write `captures/extra.yml` SHALL NOT exist

#### Scenario: Local fixtures survive a set that carries none

- **WHEN** a served set carries no file under `.tests/` and the local rule has `.tests/`
- **THEN** the local `.tests/` SHALL be left in place

#### Scenario: A generated rule's revision is confirmed

- **WHEN** `rule create` or `rule improve` fetches a produced rule whose served `revisionId` differs from the one the request reported
- **THEN** the CLI SHALL refuse that rule and write nothing for it
