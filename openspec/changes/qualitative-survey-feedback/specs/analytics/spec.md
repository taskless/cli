## MODIFIED Requirements

### Requirement: CLI events use cli\_ prefix

CLI events SHALL use the `cli_` prefix, with the taxonomy organized as a
`cli_run` denominator plus concrete state-transition events:

- `cli_run` — exactly one per invocation (see the dedicated requirement). This
  replaces every previous `cli_<action>` start event and `cli_<action>_completed`
  event; the `success`/`durationMs`/`command` signal lives here.
- Concrete state-transition events, each fired at the point the state actually
  changes, carrying counts/ids/booleans only (never rule content, prompts, or
  matched source):
  - `cli_rule_created`, `cli_rule_improved`, `cli_rule_deleted`
  - `cli_authenticated`, `cli_logged_out`
  - `cli_installed`, `cli_onboarded`
  - `cli_check_completed` — error/warning counts and the number of rules the
    scan had loaded: `errorCount`, `warningCount`, `findings`, `ruleCount`.
    Counts only, never rule content, rule names, or matched source
  - `cli_error` — a single failure event with `command` and `code` (a stable
    `CLIErrorCode`)
- `cli_agent` — fired when the `agent` command serves a request, with a `topic`
  property (the served topic; the exact literal `"(index)"` when invoked with no
  topic; the attempted topic for an unknown request). This replaces the previous
  `help_index`, `help_<topic>`, and `help_unknown` events.

Commands that carry no concrete state beyond the invocation (e.g. `info`,
`detect`, `update`, `auth status`, `rule verify`, `rule meta`) SHALL rely on
`cli_run` alone and SHALL NOT emit a bespoke event. The previous taxonomy
(`cli_<action>`, `cli_<action>_completed`, `help_index`, `help_<topic>`,
`help_unknown`) SHALL be removed in this release; there is no dual-emit window.

The survey events are the one exception to the prefix. `survey shown`,
`survey dismissed`, and `survey sent` are PostHog's own event literals for a
custom survey, and their `$survey_id` and `$survey_response_<question id>`
keys are PostHog's property contract; the CLI SHALL emit them under those
exact names and SHALL add no survey-specific property of its own. They go
through the same capture path as every other event, so the standard
properties (`cli`, `cliVersion`, `scaffoldVersion`, `ghOwner`, and the
adoption dimensions) ride on them the way they ride on everything else. No
other event SHALL omit the `cli_` prefix.

#### Scenario: Rule creation emits a concrete state event plus cli_run

- **WHEN** a user runs `taskless rule create --from req.json` and a rule is written
- **THEN** PostHog SHALL receive one `cli_run` event with `command: "rule create"`
- **AND** SHALL receive a `cli_rule_created` event
- **AND** SHALL NOT receive `cli_rule_create` or `cli_rule_create_completed`

#### Scenario: Recipe fetch emits cli_agent with a topic

- **WHEN** an agent runs `taskless agent create-sg-rule`
- **THEN** PostHog SHALL receive a `cli_agent` event with `topic: "create-sg-rule"`
- **AND** SHALL NOT receive a `help_create_sg_rule` event

#### Scenario: Fetch with no topic emits cli_agent with the index marker

- **WHEN** an agent runs `taskless agent`
- **THEN** PostHog SHALL receive a `cli_agent` event with `topic: "(index)"`
- **AND** SHALL NOT receive a `help_index` event

#### Scenario: A command failure emits cli_error

- **WHEN** a command fails with a known `CLIErrorCode`
- **THEN** PostHog SHALL receive a `cli_error` event with `command` and `code`

#### Scenario: Old event names are not emitted

- **WHEN** any CLI command runs in this release
- **THEN** PostHog SHALL NOT receive any event named `cli_<action>_completed`,
  `help_index`, `help_<topic>`, or `help_unknown`

#### Scenario: A completed scan reports how many rules were loaded

- **WHEN** a scan completes
- **THEN** the `cli_check_completed` event SHALL include `ruleCount`, the number
  of rules the scan had loaded
- **AND** a scan that loaded no rules SHALL be distinguishable from a scan that
  loaded rules and found nothing

#### Scenario: Survey events keep PostHog's names and carry the standard properties

- **WHEN** the CLI serves a survey invite, records a dismissal, or sends a response
- **THEN** PostHog SHALL receive `survey shown`, `survey dismissed`, or `survey sent` respectively, under that exact name
- **AND** the event SHALL carry `$survey_id` and the standard properties, and no survey-specific property beyond PostHog's own keys
- **AND** no event named `cli_survey_shown`, `cli_survey_dismissed`, or `cli_survey_sent` SHALL be emitted
