## REMOVED Requirements

### Requirement: Reconcile verdicts are applied per engine

**Reason**: Its scenario "An edited runtime rule is withheld, not failed" states the behavior this change reverses (#655), and a MODIFIED block cannot drop a scenario, so the requirement is replaced under a new title.

**Migration**: Replaced by "Each engine applies the reconcile verdict policy", identical except that a runtime `unsafe` verdict fails `check`, with the scenario "An edited runtime rule fails and does not execute" in place of the reversed one.

## ADDED Requirements

### Requirement: Each engine applies the reconcile verdict policy

The CLI SHALL read the v2 reconcile response as a list of per-rule verdicts
(`rules[]`, each `{ ruleId, engine, verdict }` with `verdict` one of `run`, `unsafe`,
`missing`), a list of `unknown` rules (each `{ ruleId, copyOf? }`), and
`entitlement.withheld`, and SHALL apply this policy:

| Verdict              | runtime                                            | sg / vale                                   |
| -------------------- | -------------------------------------------------- | ------------------------------------------- |
| `run`                | execute                                            | run                                         |
| `withheld`           | do not execute; fail `check`                       | (never sent)                                |
| `unsafe`             | do not execute; fail `check`; name the recovery    | do not run; fail `check`; name the recovery |
| `missing`            | warn; name the recovery                            | warn; name the recovery                     |
| `unknown`            | do not execute (needs `--dangerously-run-scripts`) | run                                         |
| `unknown` + `copyOf` | do not execute; name the source                    | do not run; fail `check`; name the source   |

The engine SHALL be taken from the verdict's `engine` for `rules[]` entries and from the
reporting directory for `unknown` entries. An `unsafe` failure SHALL name the rule and each
differing path, saying whether it changed, was removed, or was added. "Name the recovery"
means `taskless rule restore <ruleId>`, or, when the organization's plan is known to exclude
rule recovery, the git steps for the rule's directory (see `cli-rule-recovery`, "Recovery
suggestions follow the plan"). A signature SHALL
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

- **WHEN** reconcile returns a `missing` verdict for any engine, and no `unknown` rule names it in `copyOf`, and the organization's plan is not known to exclude rule recovery
- **THEN** the CLI SHALL warn naming the rule and `taskless rule restore <ruleId>`
- **AND** SHALL NOT change the exit code because of it

#### Scenario: An edited runtime rule fails and does not execute

- **WHEN** reconcile returns an `unsafe` verdict for a runtime rule
- **THEN** the rule SHALL NOT execute
- **AND** `check` SHALL exit non-zero naming the rule, each differing path, and the recovery
