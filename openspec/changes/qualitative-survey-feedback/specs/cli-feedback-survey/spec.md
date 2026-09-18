## Purpose

Collects qualitative feedback about rule authoring and onboarding through a PostHog survey the agent answers on the user's behalf: the CLI decides when to invite, the agent gathers the user's words and its own observation of the session, and the CLI validates and sends the response.

## ADDED Requirements

### Requirement: A survey invite is appended to surveyed recipes when the gate is open

When the CLI serves one of the surveyed recipes (`onboard`, `create-sg-rule`, `create-vale-rule`, `create-remote-rule`) through `taskless agent <topic>` or `taskless onboard`, it SHALL append the survey invite to the served text if and only if every gate condition holds:

- telemetry is enabled (neither `DO_NOT_TRACK=1` nor `TASKLESS_TELEMETRY_DISABLED=1`);
- `CI` is neither `"true"` nor `"1"`;
- the survey's `next_ask` timestamp is absent, unparseable, or not later than now.

When the gate is open the CLI SHALL capture `survey shown` with `$survey_id`, write `next_ask` to now plus 10 days, and append the invite after the recipe's last section. When any condition fails the served text SHALL be byte-identical to the recipe as rendered without a survey. The `@taskless/cli/prompts` export SHALL never include the invite.

#### Scenario: Gate open on a surveyed topic

- **WHEN** telemetry is enabled, `CI` is unset, `next_ask` is absent, and an agent runs `taskless agent create-sg-rule`
- **THEN** stdout SHALL be the `create-sg-rule` recipe followed by the survey invite
- **AND** PostHog SHALL receive `survey shown` with `$survey_id`
- **AND** `next_ask` SHALL be written to a time about 10 days in the future

#### Scenario: Both onboarding paths carry the invite

- **WHEN** the gate is open and either `taskless onboard` or `taskless agent onboard` serves the onboarding recipe
- **THEN** both SHALL append the invite and capture `survey shown` with `$survey_id`

#### Scenario: Within the window

- **WHEN** `next_ask` is later than now and an agent runs `taskless agent create-vale-rule`
- **THEN** stdout SHALL be the recipe with no invite
- **AND** no survey event SHALL be captured and `next_ask` SHALL be unchanged

#### Scenario: Telemetry disabled

- **WHEN** `DO_NOT_TRACK=1` and an agent runs any surveyed topic
- **THEN** stdout SHALL be the recipe with no invite
- **AND** `next_ask` SHALL NOT be read or written

#### Scenario: Running in CI

- **WHEN** `CI=true` and telemetry is enabled and an agent runs any surveyed topic
- **THEN** stdout SHALL be the recipe with no invite
- **AND** no survey event SHALL be captured

#### Scenario: Unsurveyed topic

- **WHEN** the gate would otherwise be open and an agent runs `taskless agent check`
- **THEN** stdout SHALL be the recipe with no invite
- **AND** `next_ask` SHALL be unchanged

#### Scenario: Corrupt cadence file is repaired

- **WHEN** `next_ask` contains text that is not a number and an agent runs a surveyed topic with the other conditions met
- **THEN** the invite SHALL be appended
- **AND** `next_ask` SHALL be overwritten with a valid timestamp

### Requirement: The cadence store is one epoch timestamp per survey

The CLI SHALL keep the survey cadence at `<config directory>/surveys/<survey id>/next_ask`, where the config directory is the same XDG location that holds the anonymous telemetry id and the survey id is the PostHog survey's UUID. The file SHALL contain a single decimal epoch-milliseconds value: the earliest time the next invite may be served. Serving an invite SHALL set it to now plus 10 days; `feedback dismiss` and `feedback send` SHALL each set it to now plus 20 days. Every CLI version SHALL share the file, so upgrading the CLI does not reset the cadence; a different survey id SHALL have its own file.

#### Scenario: A CLI upgrade keeps the cadence

- **WHEN** version A served an invite yesterday and the user runs version B for the first time
- **THEN** version B SHALL read the same `next_ask` and SHALL NOT serve the invite

#### Scenario: A new survey is a new ask

- **WHEN** the CLI ships with a different survey id than the one whose `next_ask` is on disk
- **THEN** the CLI SHALL find no `next_ask` for the new survey and SHALL serve the invite

#### Scenario: Dismissal earns the longer gap

- **WHEN** an invite was served and the agent runs `taskless feedback dismiss`
- **THEN** `next_ask` SHALL be about 20 days in the future, later than the value the invite wrote

### Requirement: The feedback subcommand records dismissals and sends responses

The CLI SHALL provide a `feedback` subcommand with two verbs. `feedback dismiss` SHALL capture `survey dismissed` with `$survey_id` and advance `next_ask`. `feedback send --from <path>` SHALL read a JSON file, validate it against the feedback payload schema, capture `survey sent`, and advance `next_ask`. Both verbs SHALL accept `--dir`. Neither SHALL require `.taskless/` to exist, run migrations, or write into the project. `feedback send` SHALL NOT delete its input file.

When the telemetry client is disabled, both verbs SHALL print a single line saying nothing was sent and exit zero.

`feedback` SHALL NOT appear in the `taskless agent` topic index. `taskless agent feedback` SHALL still serve the `feedback` recipe.

#### Scenario: Dismiss

- **WHEN** an agent runs `taskless feedback dismiss`
- **THEN** PostHog SHALL receive `survey dismissed` with `$survey_id`
- **AND** the command SHALL exit zero

#### Scenario: Send a valid payload

- **WHEN** an agent runs `taskless feedback send --from .taskless/.tmp-feedback.json` with a payload that passes validation
- **THEN** PostHog SHALL receive `survey sent` carrying `$survey_id` and one `$survey_response_<question id>` per answered question, and no other survey-specific property
- **AND** the command SHALL exit zero and leave the input file in place

#### Scenario: Send an invalid payload

- **WHEN** the payload is missing a required key or `completed` is not one of the allowed values
- **THEN** the command SHALL exit non-zero with `INVALID_INPUT`, naming the failing field
- **AND** no survey event SHALL be captured and `next_ask` SHALL be unchanged

#### Scenario: Telemetry disabled

- **WHEN** `DO_NOT_TRACK=1` and an agent runs either verb
- **THEN** the command SHALL print that nothing was sent and exit zero

#### Scenario: Not in the index

- **WHEN** an agent runs `taskless agent`
- **THEN** the printed index SHALL NOT list `feedback`

### Requirement: The feedback payload uses human keys mapped to survey questions by the CLI

The feedback payload SHALL be a JSON object with these keys:

| key                | required | value                                             |
| ------------------ | -------- | ------------------------------------------------- |
| `verbatim`         | yes      | the user's own words, non-empty                   |
| `goal`             | yes      | what the user was trying to accomplish, non-empty |
| `completed`        | yes      | exactly `Yes`, `No`, or `Unknown`                 |
| `workedWell`       | no       | what worked well                                  |
| `needsImprovement` | no       | what could use improvement                        |

The CLI SHALL own the map from these keys to the survey's question identifiers; a payload SHALL NOT contain `$survey_*` keys. An omitted optional key SHALL be omitted from the event rather than sent as an empty string. The schema SHALL be embedded in the `feedback` recipe through the recipe input-schema mechanism.

#### Scenario: Optional answers are omitted, not blanked

- **WHEN** a payload has no `workedWell`
- **THEN** the `survey sent` event SHALL carry no `$survey_response_` key for that question

#### Scenario: Completion is one of three literals

- **WHEN** a payload has `completed: "partially"`
- **THEN** validation SHALL fail naming `completed`

### Requirement: The feedback and feedback-invite recipes

The CLI SHALL embed a `feedback` recipe that tells the agent it is the respondent: it records the user's reply verbatim, fills the remaining answers from its own observation of the session, writes the payload to `.taskless/.tmp-feedback.json`, runs `feedback send --from` that path, and deletes the file afterwards. The recipe SHALL embed the payload schema and SHALL NOT ask the agent to put the survey's questions to the user one by one.

The CLI SHALL embed a `feedback-invite` recipe carrying the text appended to surveyed recipes. Rendered header-less, it SHALL instruct the agent to ask the user exactly once, with the sentence "Taskless would like to know how the CLI is doing. Would you be okay sharing a few sentences about your experience? Or just skip it with `skip`."; to treat a reply of `skip`, silence, or a reply unrelated to feedback as a dismissal and run `feedback dismiss`; and to treat any other reply as feedback and fetch `agent feedback`. Both recipes SHALL follow the recipe conventions: a `# Topic:` header, the CLI named by its rendered invocation, and commands that exist.

#### Scenario: The appended invite carries no header

- **WHEN** the gate is open and a surveyed recipe is served
- **THEN** the appended text SHALL NOT contain a second `# Topic:` line
- **AND** SHALL name the rendered CLI invocation for both `feedback dismiss` and `agent feedback`

#### Scenario: The feedback recipe embeds the schema

- **WHEN** an agent runs `taskless agent feedback`
- **THEN** stdout SHALL open with `# Topic: feedback` and contain the JSON Schema for the payload
