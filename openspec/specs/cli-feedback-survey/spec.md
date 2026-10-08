# cli-feedback-survey Specification

## Purpose

Carries feedback from the user's agent to the Taskless team through PostHog surveys, over three channels: the rule-authoring and onboarding survey the CLI invites and the agent answers on the user's behalf, and general feedback and bug reports, which the user chooses to give and which need no GitHub account. The CLI decides when to invite, the agent gathers the user's words and its own observation of the session, and the CLI validates each response and sends it to the survey its kind selects.

## Requirements

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

The CLI SHALL keep the survey cadence at `<config directory>/surveys/<survey id>/next_ask`, where the config directory is the same XDG location that holds the anonymous telemetry id and the survey id is the PostHog survey's UUID. The file SHALL contain a single decimal epoch-milliseconds value: the earliest time the next invite may be served. Serving an invite SHALL set it to now plus 10 days; `feedback dismiss` and a `feedback send` of a `rule` payload SHALL each set it to now plus 20 days. A `feedback send` of a `general` or `bug` payload SHALL NOT read or write any cadence file. Every CLI version SHALL share the file, so upgrading the CLI does not reset the cadence; a different survey id SHALL have its own file.

#### Scenario: A CLI upgrade keeps the cadence

- **WHEN** version A served an invite yesterday and the user runs version B for the first time
- **THEN** version B SHALL read the same `next_ask` and SHALL NOT serve the invite

#### Scenario: A new survey is a new ask

- **WHEN** the CLI ships with a different survey id than the one whose `next_ask` is on disk
- **THEN** the CLI SHALL find no `next_ask` for the new survey and SHALL serve the invite

#### Scenario: Dismissal earns the longer gap

- **WHEN** an invite was served and the agent runs `taskless feedback dismiss`
- **THEN** `next_ask` SHALL be about 20 days in the future, later than the value the invite wrote

#### Scenario: A bug report leaves the cadence alone

- **WHEN** `next_ask` holds a value and an agent sends a valid `bug` payload with `feedback send`
- **THEN** `next_ask` SHALL be unchanged
- **AND** no cadence file SHALL be created for the bug survey

### Requirement: The feedback subcommand records dismissals and sends responses

The CLI SHALL provide a `feedback` subcommand with two verbs. `feedback dismiss` SHALL capture `survey dismissed` with the rule survey's `$survey_id` and advance that survey's `next_ask`. `feedback send --from <path>` SHALL read a JSON file, validate it against the feedback payload schema, and capture `survey sent` with the `$survey_id` of the survey the payload's `kind` selects; for a `rule` payload it SHALL also advance `next_ask`. Both verbs SHALL accept `--dir`. Neither SHALL require `.taskless/` to exist, run migrations, or write into the project. `feedback send` SHALL NOT delete its input file.

When the telemetry client is disabled, `feedback dismiss` SHALL print a single line saying nothing was sent and exit zero. `feedback send` SHALL still validate the payload first, and on a valid payload SHALL send nothing, print that telemetry is disabled so nothing was sent, name `https://github.com/taskless/cli/issues` as the place to report instead, and exit zero.

The `taskless agent` topic index SHALL list `feedback` and `bug-report` and SHALL NOT list `rule-feedback`. `taskless agent rule-feedback` SHALL still serve the `rule-feedback` recipe.

#### Scenario: Dismiss

- **WHEN** an agent runs `taskless feedback dismiss`
- **THEN** PostHog SHALL receive `survey dismissed` with the rule survey's `$survey_id`
- **AND** the command SHALL exit zero

#### Scenario: Send a valid payload

- **WHEN** an agent runs `taskless feedback send --from .taskless/.tmp-feedback.json` with a payload that passes validation
- **THEN** PostHog SHALL receive `survey sent` carrying the `$survey_id` for the payload's `kind` and one `$survey_response_<question id>` per answered question, and no other survey-specific property
- **AND** the command SHALL exit zero and leave the input file in place

#### Scenario: Each kind reaches its own survey

- **WHEN** valid payloads of kind `rule`, `general`, and `bug` are each sent
- **THEN** their `survey sent` events SHALL carry `$survey_id` `01a0c7b9-dfe4-0000-d05e-ce253e90a68c`, `01a11da4-3948-0000-4ae4-c9da9321801e`, and `01a11da7-27a2-0000-0f4e-6d3e1f89f385` respectively

#### Scenario: Send an invalid payload

- **WHEN** the payload is missing a required key, has no `kind` or an unknown `kind`, or `completed` is not one of the allowed values
- **THEN** the command SHALL exit non-zero with `INVALID_INPUT`, naming the failing field
- **AND** no survey event SHALL be captured and `next_ask` SHALL be unchanged

#### Scenario: Telemetry disabled

- **WHEN** `DO_NOT_TRACK=1` and an agent runs `feedback dismiss`, or runs `feedback send` with a valid payload of any kind
- **THEN** the command SHALL send nothing and exit zero
- **AND** `feedback send` SHALL print that telemetry is disabled and name `https://github.com/taskless/cli/issues`

#### Scenario: Telemetry disabled does not excuse an invalid payload

- **WHEN** `DO_NOT_TRACK=1` and the payload fails validation
- **THEN** the command SHALL exit non-zero with `INVALID_INPUT`

#### Scenario: Not in the index

- **WHEN** an agent runs `taskless agent`
- **THEN** the printed index SHALL NOT list `rule-feedback`

#### Scenario: The user-initiated channels are in the index

- **WHEN** an agent runs `taskless agent`
- **THEN** the printed index SHALL list `feedback` and `bug-report`

### Requirement: The feedback payload uses human keys mapped to survey questions by the CLI

The feedback payload SHALL be a JSON object with a required `kind` of exactly `rule`, `general`, or `bug`, which selects the survey and the remaining keys. Keys belonging to another kind SHALL be rejected rather than ignored.

For `kind: "rule"`:

| key                | required | value                                                                                                 |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `ruleKind`         | yes      | the kind of rule the user was trying to create, non-empty; `none (onboarding)` on the onboarding path |
| `verbatim`         | no       | the user's own words, unedited                                                                        |
| `completed`        | no       | exactly `Yes`, `No`, or `Unknown`                                                                     |
| `workedWell`       | no       | what worked well                                                                                      |
| `needsImprovement` | no       | what could use improvement                                                                            |
| `agents`           | no       | the open-source, publicly available agent(s) or framework(s) in use                                   |
| `mostValuableRule` | no       | the rule creating the most value for the team, and why                                                |

For `kind: "general"`:

| key        | required | value                                                                    |
| ---------- | -------- | ------------------------------------------------------------------------ |
| `verbatim` | yes      | the user's feedback in their own words, unedited                         |
| `context`  | no       | the agent's account of what led to the feedback, as approved by the user |

For `kind: "bug"`:

| key        | required | value                                |
| ---------- | -------- | ------------------------------------ |
| `summary`  | yes      | a one-line summary of the bug        |
| `trying`   | yes      | what the user was trying to do       |
| `expected` | yes      | the expected result                  |
| `actual`   | yes      | the actual result                    |
| `context`  | no       | anything else that would help fix it |

The CLI SHALL own the map from these keys to each survey's question identifiers; a payload SHALL NOT contain `$survey_*` keys. An omitted optional key SHALL be omitted from the event rather than sent as an empty string, and a key that is present SHALL be non-blank. Each recipe SHALL embed the schema for its own kind through the recipe input-schema mechanism.

#### Scenario: Optional answers are omitted, not blanked

- **WHEN** a `rule` payload has no `workedWell`
- **THEN** the `survey sent` event SHALL carry no `$survey_response_` key for that question

#### Scenario: Completion is one of three literals

- **WHEN** a `rule` payload has `completed: "partially"`
- **THEN** validation SHALL fail naming `completed`

#### Scenario: The rule kind alone is a complete response

- **WHEN** a payload is `{ "kind": "rule", "ruleKind": "ast-grep, forbid eval in TypeScript" }`
- **THEN** validation SHALL pass
- **AND** the `survey sent` event SHALL carry `$survey_id` and exactly one `$survey_response_<question id>` key

#### Scenario: A missing rule kind is rejected

- **WHEN** a `rule` payload carries every optional key and no `ruleKind`
- **THEN** validation SHALL fail naming `ruleKind`

#### Scenario: A payload without a kind is rejected

- **WHEN** a payload is `{ "ruleKind": "ast-grep, forbid eval in TypeScript" }`
- **THEN** validation SHALL fail naming `kind`

#### Scenario: Keys from another kind are rejected

- **WHEN** a `general` payload carries `ruleKind`
- **THEN** validation SHALL fail naming `ruleKind`

#### Scenario: A bug report needs its four required answers

- **WHEN** a `bug` payload omits `expected`
- **THEN** validation SHALL fail naming `expected`

### Requirement: The rule-feedback and feedback-invite recipes

The CLI SHALL embed a `rule-feedback` recipe that tells the agent it is the respondent: it records the user's reply verbatim when there is one, fills the remaining answers from its own observation of the session, writes the payload with `kind: "rule"` to `.taskless/.tmp-feedback.json`, runs `feedback send --from` that path, and deletes the file afterwards. When the user replied `review`, it SHALL show every answer in the payload in the chat, labelled by key and exactly as it will be sent, name the keys it omitted, and offer to correct anything before sending; after each round of corrections it SHALL show the corrected payload in full and ask again, and it SHALL run `feedback send` only on the user's go-ahead, and SHALL run `feedback dismiss` instead if the user then decides not to send. The recipe SHALL embed the `rule` payload schema, SHALL NOT ask the agent to put the survey's questions to the user one by one, and SHALL NOT permit a follow-up question other than those correction rounds. It SHALL tell the agent to answer `ruleKind` with `none (onboarding)` when the surveyed recipe was `onboard`, to name only open-source, publicly available software in `agents`, and to omit `mostValuableRule` rather than ask the user for it.

The CLI SHALL embed a `feedback-invite` recipe carrying the text appended to surveyed recipes. Rendered header-less, it SHALL instruct the agent to ask the user exactly once, with the sentence "Taskless would like to know how this went. Anything you'd like to add in your own words? Reply `skip` if not, and I'll send my own notes on the session, or `review` to see what I'd send before it goes."; to treat a reply of `skip`, silence, or a reply unrelated to feedback as an omitted `verbatim` and still fetch `agent rule-feedback`; to treat a reply of `review`, alone or alongside the user's words, as a request to see the answers before they are sent, with any other words in it as `verbatim`, and fetch `agent rule-feedback`; to treat any other reply as the user's words and fetch `agent rule-feedback`; and, only when the user explicitly asks for nothing to be sent, to run `feedback dismiss` and name the telemetry opt-out environment variables in one line. Both recipes SHALL follow the recipe conventions: a `# Topic:` header, the CLI named by its rendered invocation, and commands that exist.

#### Scenario: The appended invite carries no header

- **WHEN** the gate is open and a surveyed recipe is served
- **THEN** the appended text SHALL NOT contain a second `# Topic:` line
- **AND** SHALL name the rendered CLI invocation for both `feedback dismiss` and `agent rule-feedback`

#### Scenario: The rule-feedback recipe embeds the schema

- **WHEN** an agent runs `taskless agent rule-feedback`
- **THEN** stdout SHALL open with `# Topic: rule-feedback` and contain the JSON Schema for the `rule` payload

#### Scenario: An explicit refusal is honoured

- **WHEN** the user replies to the invite asking that nothing be sent
- **THEN** the invite SHALL direct the agent to `feedback dismiss`
- **AND** SHALL direct it to name `DO_NOT_TRACK=1` or `TASKLESS_TELEMETRY_DISABLED=1` as the switch for the rest of telemetry

#### Scenario: A skip still sends

- **WHEN** the user replies `skip` to the invite
- **THEN** the invite SHALL direct the agent to `agent rule-feedback` rather than `feedback dismiss`
- **AND** the rule-feedback recipe SHALL direct the agent to omit `verbatim` and send the rest

#### Scenario: A review shows the answers before they are sent

- **WHEN** the user replies `review` to the invite
- **THEN** the invite SHALL direct the agent to `agent rule-feedback` rather than `feedback dismiss`
- **AND** the rule-feedback recipe SHALL direct the agent to show every answer in the chat and offer to correct them before running `feedback send`
- **AND** SHALL direct the agent to show the corrected payload again after each correction, sending only on the user's go-ahead
- **AND** SHALL direct the agent to `feedback dismiss` if the user then decides not to send

### Requirement: The general feedback recipe

The CLI SHALL embed a `feedback` recipe for feedback the user chooses to give about Taskless. It SHALL direct the agent to take the user's feedback in their own words as `verbatim`, to draft `context` from what it observed in the session that bears on that feedback, and to keep both free of secrets, credentials, absolute paths, and source code the user has not chosen to share. Before sending, the agent SHALL show the user the complete payload and SHALL send only on the user's explicit agreement; a refusal or an edit request SHALL be honoured before anything is sent. The recipe SHALL write the payload with `kind: "general"` to `.taskless/.tmp-feedback.json`, run `feedback send --from` that path, delete the file afterwards, and embed the `general` payload schema. It SHALL tell the agent that when the CLI reports telemetry is disabled, it relays that to the user along with `https://github.com/taskless/cli/issues`.

#### Scenario: The general recipe embeds its schema

- **WHEN** an agent runs `taskless agent feedback`
- **THEN** stdout SHALL open with `# Topic: feedback` and contain the JSON Schema for the `general` payload

#### Scenario: Nothing is sent without the user's yes

- **WHEN** the agent has drafted a `general` payload
- **THEN** the recipe SHALL direct it to show the user the payload and wait for explicit agreement before running `feedback send`

#### Scenario: The general recipe carries no invite

- **WHEN** the survey gate is open and an agent runs `taskless agent feedback`
- **THEN** stdout SHALL be the recipe with no survey invite appended

### Requirement: The bug-report recipe

The CLI SHALL embed a `bug-report` recipe for reporting a bug in Taskless without a GitHub account. It SHALL direct the agent to draft `summary`, `trying`, `expected`, `actual`, and `context` from the session, to ask the user only for what the session does not show, and to keep every answer free of secrets, credentials, absolute paths, and source code the user has not chosen to share. Before sending, the agent SHALL show the user the complete payload and SHALL send only on the user's explicit agreement. The recipe SHALL write the payload with `kind: "bug"` to `.taskless/.tmp-feedback.json`, run `feedback send --from` that path, delete the file afterwards, and embed the `bug` payload schema. It SHALL NOT ask the agent for version information, which the CLI supplies. It SHALL tell the agent that when the CLI reports telemetry is disabled, it relays that to the user along with `https://github.com/taskless/cli/issues`.

#### Scenario: The bug-report recipe embeds its schema

- **WHEN** an agent runs `taskless agent bug-report`
- **THEN** stdout SHALL open with `# Topic: bug-report` and contain the JSON Schema for the `bug` payload
- **AND** the schema SHALL NOT contain a version-information key

#### Scenario: Nothing is sent without the user's yes

- **WHEN** the agent has drafted a `bug` payload
- **THEN** the recipe SHALL direct it to show the user the payload and wait for explicit agreement before running `feedback send`

### Requirement: The CLI supplies a bug report's version information

When `feedback send` sends a `bug` payload, the CLI SHALL answer the bug survey's version-information question itself, from local state only: the running CLI version, the installed scaffold version and rules reconciliation marker from `.taskless/taskless.json` when present, the operating system platform and architecture, and the Node.js version. It SHALL NOT include the user's login, email, organizations, repository URL, or any absolute path, and SHALL NOT make a network call to build it. A missing or unreadable `.taskless/` SHALL produce the answer without those fields rather than an error.

#### Scenario: Version information is filled in

- **WHEN** an agent sends a valid `bug` payload from a directory with an initialised `.taskless/`
- **THEN** the `survey sent` event SHALL carry the version-information response, naming the running CLI version and the installed scaffold version

#### Scenario: No project, still a report

- **WHEN** an agent sends a valid `bug` payload from a directory with no `.taskless/`
- **THEN** the command SHALL succeed and the version-information response SHALL name the running CLI version

#### Scenario: Nothing identifying in the version answer

- **WHEN** the user is logged in and sends a `bug` payload
- **THEN** the version-information response SHALL NOT contain their login, email, organization names, or the repository URL
