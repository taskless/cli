## MODIFIED Requirements

### Requirement: Reconcile verdicts are applied per engine

The CLI SHALL read the v2 reconcile response as a list of per-rule verdicts
(`rules[]`, each `{ ruleId, engine, verdict }` with `verdict` one of `run`, `unsafe`,
`missing`), a list of `unknown` rules (each `{ ruleId, copyOf? }`), and
`entitlement.withheld`, and SHALL apply this policy:

| Verdict              | runtime                                            | sg / vale                                     |
| -------------------- | -------------------------------------------------- | --------------------------------------------- |
| `run`                | execute                                            | run                                           |
| `withheld`           | do not execute; fail `check`                       | (never sent)                                  |
| `unsafe`             | do not execute; name `rule restore`                | do not run; fail `check`; name `rule restore` |
| `missing`            | warn; name `rule restore`                          | warn; name `rule restore`                     |
| `unknown`            | do not execute (needs `--dangerously-run-scripts`) | run                                           |
| `unknown` + `copyOf` | do not execute; name the source                    | do not run; fail `check`; name the source     |

The engine SHALL be taken from the verdict's `engine` for `rules[]` entries and from the
reporting directory for `unknown` entries. An `unsafe` notice SHALL name the rule and each
differing path, saying whether it changed, was removed, or was added. A signature SHALL
authorize running a runtime rule only through a `run` verdict, never by local comparison.

#### Scenario: An edited static rule fails and does not run

- **WHEN** reconcile returns `{ ruleId: "no-simply-1a2b3c4d", engine: "vale", verdict: "unsafe", files: [{ path: ".vale.ini", expected, got }] }`
- **THEN** the rule SHALL NOT run
- **AND** `check` SHALL exit non-zero naming the rule and `.vale.ini` as changed

#### Scenario: A locally written static rule runs

- **WHEN** reconcile lists a static rule's id in `unknown` without `copyOf`
- **THEN** that rule SHALL run
- **AND** the CLI SHALL emit no notice for it

#### Scenario: A locally written runtime rule does not execute

- **WHEN** reconcile lists a runtime rule's id in `unknown` and `--dangerously-run-scripts` is not set
- **THEN** the rule SHALL NOT execute
- **AND** its skip reason SHALL say it was not issued by the rule service

#### Scenario: Missing warns and does not fail

- **WHEN** reconcile returns a `missing` verdict for any engine, and no `unknown` rule names it in `copyOf`
- **THEN** the CLI SHALL warn naming the rule and `taskless rule restore <ruleId>`
- **AND** SHALL NOT change the exit code because of it

#### Scenario: An edited runtime rule is withheld, not failed

- **WHEN** reconcile returns an `unsafe` verdict for a runtime rule
- **THEN** the rule SHALL NOT execute
- **AND** the exit code SHALL NOT change because of that verdict alone

## ADDED Requirements

### Requirement: A copy of an issued rule does not run as a local rule

When reconcile returns an `unknown` rule carrying `copyOf` (taskless/taskless#255), the CLI
SHALL NOT run or execute it, and SHALL remove it from the snapshot the engines read. For an
`sg` or `vale` rule, `check` SHALL fail with one message naming the rule, the source rule
`copyOf.ruleId`, and each path in `copyOf.files` as changed, removed, or added. For a runtime
rule, the exit code SHALL NOT change, and its skip reason SHALL name the source and say it
was not issued by the rule service.

When `copyOf.ruleId` is also returned as `missing`, the CLI SHALL report the pair as one
rename: the copy's message SHALL say the source was deleted and SHALL name
`taskless rule restore <copyOf.ruleId>`, and the CLI SHALL NOT print a separate `missing`
warning for the source. A runtime rename SHALL be one notice and SHALL NOT change the exit
code. `copyOf` absent or `null` SHALL be treated as no copy. A `copyOf` that is present but
has no non-empty string `ruleId` SHALL fail closed: the rule SHALL be treated as
unaccounted.

#### Scenario: A renamed and loosened Vale rule fails check as one rename

- **WHEN** reconcile returns vale rule `bar-2` in `unknown` with `copyOf.ruleId` `foo-1` and `copyOf.files` listing `.vale.ini` changed, and returns `foo-1` as `missing`
- **THEN** `bar-2` SHALL NOT run
- **AND** `check` SHALL exit non-zero with one message saying `bar-2` is a copy of `foo-1`, which was deleted, naming `.vale.ini` as changed and `taskless rule restore foo-1`
- **AND** the CLI SHALL NOT print a separate warning that `foo-1` is missing

#### Scenario: A copy beside its present source fails check

- **WHEN** reconcile returns sg rule `bar-2` in `unknown` with `copyOf.ruleId` `foo-1`, and `foo-1` is not `missing`
- **THEN** `bar-2` SHALL NOT run
- **AND** `check` SHALL exit non-zero naming `bar-2` as a copy of `foo-1`

#### Scenario: A runtime copy is not executed and does not fail

- **WHEN** reconcile returns a runtime rule in `unknown` with `copyOf`
- **THEN** the rule SHALL NOT execute
- **AND** its skip reason SHALL name the source rule
- **AND** the exit code SHALL NOT change because of it

#### Scenario: An unreadable copyOf fails closed

- **WHEN** reconcile returns a rule in `unknown` whose `copyOf` is present but has no string `ruleId`
- **THEN** the rule SHALL NOT run or execute
- **AND** `check` SHALL exit non-zero naming it
