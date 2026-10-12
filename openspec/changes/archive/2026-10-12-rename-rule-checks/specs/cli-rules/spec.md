## MODIFIED Requirements

### Requirement: Rules subcommand group exists

The CLI SHALL expose the rule operations under the `rule` (singular) subcommand group. The user-facing surface SHALL be `taskless rule create`, `taskless rule improve`, `taskless rule delete`, and `taskless rule meta`. Rule validation is not part of this group — it is addressed by path through the top-level `validate` and `verify` commands, specified by the `cli-rule-validation` capability. The internal source filename (`packages/cli/src/commands/rules.ts`) MAY remain plural — only the user-visible subcommand name changes.

The previous plural form `taskless rules <subcommand>` SHALL NOT work in v0.7.0 — there is no compatibility alias.

#### Scenario: Singular subcommand registers correctly

- **WHEN** a user runs `taskless rule create --from req.json`
- **THEN** the CLI SHALL invoke the rule-create handler

#### Scenario: Plural subcommand is no longer recognized

- **WHEN** a user runs `taskless rules create --from req.json`
- **THEN** the CLI SHALL exit with an error indicating the subcommand is unknown
- **AND** the error message SHOULD suggest `taskless rule create`

### Requirement: The rule subcommand group no longer validates rules

`taskless rule verify` SHALL NOT exist. Rule validation is addressed by path through the top-level `validate` and `verify` commands, specified by the `cli-rule-validation` capability.

#### Scenario: The removed subcommand does not resolve

- **WHEN** a user runs `taskless rule verify no-eval`
- **THEN** the CLI SHALL exit non-zero
- **AND** it SHALL NOT validate a rule

### Requirement: Generated schema is importable at build time

The generated JSON Schema file SHALL be importable by the CLI bundle via Vite. The import SHALL make the full JSON Schema object available at runtime without filesystem reads or network fetches.

#### Scenario: Schema imported in verify command

- **WHEN** the `validate` command needs the ast-grep schema
- **THEN** it SHALL import the schema from `../generated/ast-grep-rule-schema.json`
- **AND** the schema object SHALL be available synchronously at runtime

### Requirement: Rule improve supports anonymous local-only flow

When `taskless rule improve --anonymous` is invoked, the CLI SHALL execute the local-only rule-improvement flow (previously implemented as the `taskless-improve-rule-anonymous` skill body). The flow SHALL:

1. NOT submit any request to the Taskless API iterate endpoint
2. Update the rule file in place using local logic
3. Support the validate feedback loop by exposing the top-level `validate` primitive that the agent invokes between edits
4. Return the same output format as the API-backed branch

#### Scenario: rule improve --anonymous skips API

- **WHEN** a user runs `taskless rule improve --from iterate.json --anonymous`
- **THEN** the CLI SHALL NOT make any HTTP request to the Taskless API
- **AND** SHALL update the target rule file

**API contract.** The requirements below describe the service endpoints the
`rule` subcommands call. They are grouped by a bold line rather than a
heading: a second `##` inside this section ends it, and everything after it
stops being read as a requirement.
