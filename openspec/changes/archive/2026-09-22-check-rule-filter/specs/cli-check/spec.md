## ADDED Requirements

### Requirement: Check restricts the run to named rules with --rule

The `check` subcommand SHALL accept a `--rule <id>` flag, repeatable, naming the rules the run is restricted to. When `--rule` is absent the run SHALL be unchanged. When one or more are given, the CLI SHALL report findings only for the named rules, and for each named rule SHALL report exactly what an unfiltered `check` over the same paths would have reported for it: the same walk, the same exclusions (`.taskless/`, `.git/`, git-ignored paths, converter-dependent formats), and the same per-rule scope.

A rule id is the name of a rule's directory under `.taskless/rules/<engine>/`. The filter SHALL apply to every engine. An id whose rule directory exists under more than one engine SHALL select the rule under each of them. An id that names no rule directory under any engine SHALL be refused: the CLI SHALL exit with code 1 and report the error code `RULE_NOT_FOUND` naming the unresolved id, and SHALL NOT run any engine.

`--rule` SHALL NOT widen what may run. A runtime rule named by `--rule` SHALL remain subject to the signature-validated path, and SHALL be reported as skipped on an unverified path exactly as it would be in an unfiltered run.

#### Scenario: A single --rule narrows the run to that rule

- **WHEN** a user runs `taskless check --rule <id>` in a project with rules beyond `<id>`
- **THEN** the results SHALL contain findings for `<id>` only
- **AND** they SHALL be the findings an unfiltered `taskless check` reports for `<id>`

#### Scenario: Repeated --rule unions the named rules

- **WHEN** a user runs `taskless check --rule a --rule b`
- **THEN** the results SHALL contain the findings for `a` and the findings for `b`, and no others

#### Scenario: The filter applies to both static engines

- **WHEN** a user names an ast-grep rule with `--rule`, and separately names a Vale rule
- **THEN** each run SHALL report that rule's findings over the whole project
- **AND** a Vale rule SHALL be measured under its own config's matchers, not over every file Vale can read

#### Scenario: Whole-project exclusions still apply under --rule

- **WHEN** a user runs `taskless check --rule <id>` with no positional paths in a project with git-ignored directories
- **THEN** the CLI SHALL NOT report findings from `.taskless/`, `.git/`, or git-ignored paths

#### Scenario: A refused sibling config refuses a filtered run too

- **WHEN** a user runs `taskless check --rule <id>` in a project where a DIFFERENT Vale rule's config is rejected by the config schema
- **THEN** the CLI SHALL refuse the Vale engine and exit non-zero, exactly as an unfiltered `taskless check` does
- **AND** the refusal SHALL name the rejected rule even though `--rule` did not select it

#### Scenario: An unknown rule id is refused

- **WHEN** a user runs `taskless check --rule <id>` and no engine directory holds a rule directory named `<id>`
- **THEN** the CLI SHALL exit with code 1
- **AND** under `--json` stdout SHALL carry the standardized error envelope with code `RULE_NOT_FOUND` and a message naming `<id>`
- **AND** the CLI SHALL NOT run any engine

#### Scenario: An id held by two engines selects both rules

- **WHEN** a user runs `taskless check --rule <id>` and `<id>` names a rule directory under two engines
- **THEN** the CLI SHALL run both rules and SHALL report the findings of each, distinguished by the `source` field

#### Scenario: --rule does not bypass the runtime signature gate

- **WHEN** a user runs `taskless check --rule <id>` where `<id>` is a runtime rule and the run is on an unverified path
- **THEN** the CLI SHALL NOT execute that rule's `check.ts`
- **AND** SHALL report it as skipped exactly as an unfiltered `check` would

#### Scenario: --rule leaves positional path arguments intact

- **WHEN** a user runs `taskless check --rule <id> src/foo.ts`
- **THEN** the CLI SHALL treat `src/foo.ts` as the path to scan and `<id>` as the rule filter
- **AND** SHALL NOT treat `<id>` as a path
