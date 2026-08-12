# cli-vale-rule-engine Specification

## Purpose

TBD - created by archiving change add-vale-rule-engine. Update Purpose after archive.

## Requirements

### Requirement: Vale runs in the static tier without reconciliation or signing

The system SHALL treat Vale as a static-tier engine — always run, with no server reconciliation or signature verification. Vale's `script` checks execute in a sandbox that exposes only pure-computation modules (`text`/`math`/`fmt`) with no host access, so a Vale rule is inert data equivalent in trust to a static ast-grep rule.

#### Scenario: Vale runs when anonymous

- **WHEN** the CLI runs a check while logged out or anonymous
- **THEN** Vale rules are executed the same as ast-grep static rules, with no reconcile or signing step

### Requirement: Vale check executes against the committed config over the target paths

The system SHALL run `vale --config .taskless/vale/.vale.ini --output=JSON --no-exit` over the resolved target paths, reading the committed config and styles as-is. The `.vale.ini` SHALL set `MinAlertLevel = suggestion` so that every finding surfaces to the client for normalization and filtering.

#### Scenario: Check runs Vale via the committed config

- **WHEN** the CLI runs a check and `.taskless/vale/` contains rules
- **THEN** it invokes Vale with `--config .taskless/vale/.vale.ini` over the target paths and parses the JSON output

#### Scenario: No Vale rules present

- **WHEN** `.taskless/vale/rules/` is empty
- **THEN** the CLI does not invoke Vale and produces no Vale findings

### Requirement: Per-rule scoping is expressed via Vale config matchers

The system SHALL express a Vale rule's scope through `.vale.ini` **matchers** — `[<glob>]` sections. Include is `rules.<name> = YES`, exclude is `rules.<name> = NO`.

Precedence is **positional**, and the system SHALL order matchers accordingly rather than relying on a disable to win on its own. Measured against Vale 3.17.1:

- Where two matchers both match a file, the **last** one wins for that rule.
- Where the same key is assigned twice inside one matcher — including across duplicate `[<glob>]` sections, which Vale merges — the **first** assignment wins.

A disable therefore SHALL be declared **after** the enable it narrows. Duplicate `[<glob>]` matchers SHALL be treated as merged, and a rule's scope SHALL NOT be expressed as a repeated assignment of the same key within one glob, since the later assignment is discarded.

#### Scenario: Duplicate matchers merge

- **WHEN** two `[*.md]` matchers each enable a different rule
- **THEN** both rules run on a matching `.md` file (Vale merges the matchers)

#### Scenario: Include scopes a rule to a path

- **WHEN** a rule is enabled only under `[marketing/**]`
- **THEN** the rule produces findings in `marketing/` files and none in `api/` files

#### Scenario: A later matcher overrides an earlier one

- **WHEN** a rule is enabled under `[marketing/**]` and then disabled under `[marketing/legacy/**]`
- **THEN** the rule fires in `marketing/` but not in `marketing/legacy/`

#### Scenario: Declaration order is significant

- **WHEN** the same two matchers are declared in the opposite order — `[marketing/legacy/**]` disabling first, `[marketing/**]` enabling second
- **THEN** the rule fires in `marketing/legacy/` as well, because the later enable wins; a disable does not take precedence on its own

### Requirement: Vale findings map to the scanner-agnostic CheckResult

The system SHALL map each Vale finding to a `CheckResult` with `source` `"vale"` and `ruleId` equal to the Vale check name with its `rules.` prefix stripped. Severity SHALL be normalized `error → error`, `warning → warning`, `suggestion → hint`. The system SHALL map `message` from `Message`, `note` from `Description`/`Link`, `range` from `Line`/`Span`, `matchedText` from `Match`, and `fix` from `Action` only when the action is populated.

#### Scenario: Finding maps to CheckResult

- **WHEN** Vale reports a finding `{Check: "rules.no-simply", Severity: "warning", Line: 3, Span: [1,7], Message: "Avoid 'simply'", Match: "simply"}` in `docs/a.md`
- **THEN** the CLI emits a `CheckResult` with `source` `"vale"`, `ruleId` `"no-simply"`, `severity` `"warning"`, `message` `"Avoid 'simply'"`, `file` `"docs/a.md"`, and a `range` derived from line 3 / span 1–7

### Requirement: A Vale check is bounded by a subprocess timeout

The system SHALL bound each Vale invocation with a timeout and, on expiry, terminate the process and report the timeout rather than hanging.

#### Scenario: Runaway Vale invocation is terminated

- **WHEN** a Vale invocation exceeds its timeout
- **THEN** the CLI terminates the process and reports a timeout for the Vale engine without hanging the overall check

### Requirement: A missing Vale binary is reported without failing other engines

When the `vale` binary cannot be found or invoked, the system SHALL report that the Vale engine is unavailable and continue running other engines, rather than aborting the entire check.

#### Scenario: Vale binary absent

- **WHEN** `.taskless/vale/` has rules but the `vale` binary is not installed
- **THEN** the CLI reports the Vale engine as unavailable with an actionable message and still returns ast-grep results

### Requirement: Vale rules are verified with per-rule fixture subdirectories

The system SHALL verify a Vale rule from a `.taskless/vale/rule-tests/<rule>/` subdirectory containing `pass/` and `fail/` fixture documents. Because verification is one-time (not per-check), the system SHALL **generate** an ephemeral `.vale.ini` at verify time (StylesPath plus only that rule enabled) rather than requiring a committed one — the subdirectory holds fixtures only. Verification SHALL assert that every `fail/` fixture produces at least one finding for the rule and every `pass/` fixture produces none (mirroring ast-grep's `invalid`/`valid`).

Both buckets SHALL hold at least one document before a rule can be reported as verified. A `fail/` fixture proves the rule fires; a `pass/` fixture proves it does not over-fire; either alone establishes half the claim. A rule populating only one bucket SHALL be reported as unverified rather than passing, and the report SHALL distinguish that half-written state from a rule carrying no fixtures at all — a rule with only `pass/` fixtures would otherwise pass trivially, on an empty set of expected failures, having never demonstrated that it fires.

#### Scenario: Fail fixture triggers, pass fixture does not

- **WHEN** verify runs for a rule and generates an isolating `.vale.ini` enabling only that rule
- **THEN** verification passes because every `fail/` fixture yields a finding and every `pass/` fixture yields none

#### Scenario: Verification fails when a fail fixture does not trigger

- **WHEN** a `fail/` fixture for a rule produces no finding
- **THEN** verification reports a failure for that rule

#### Scenario: A one-sided fixture set is not verified

- **WHEN** a rule has `fail/` fixtures but no `pass/` fixtures, or `pass/` fixtures but no `fail/`
- **THEN** verification reports the rule as unverified rather than passing
- **AND** the result distinguishes a half-written fixture set from a rule with no fixtures at all

### Requirement: Taskless breadcrumbs use a namespaced ignored key in the Vale config

Any Taskless-owned breadcrumb the system records in `.vale.ini` SHALL use a `tskl) <name> = <value>` key. The system SHALL NOT rely on Vale enforcing these keys; they are read only by Taskless tooling, and Vale's ini parser accepts and ignores them. Each Taskless-owned matcher SHALL carry a `tskl) rule = <id>` key naming its owning rule, so tooling can locate and update the right rule's matchers even when its scoping is split across multiple (possibly duplicate) matchers.

#### Scenario: Breadcrumb key is ignored by Vale

- **WHEN** `.vale.ini` contains a `tskl) rule = no-simply` key
- **THEN** Vale runs normally, ignoring the key, and Taskless tooling can read it back

#### Scenario: Canonical id locates a rule's matchers

- **WHEN** a rule's scoping spans several matchers each tagged `tskl) rule = no-simply`
- **THEN** tooling can find every matcher owned by `no-simply` by its `tskl) rule` id rather than by glob
