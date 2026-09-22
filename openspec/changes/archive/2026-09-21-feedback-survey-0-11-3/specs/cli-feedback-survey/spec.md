## MODIFIED Requirements

### Requirement: The feedback payload uses human keys mapped to survey questions by the CLI

The feedback payload SHALL be a JSON object with these keys:

| key                | required | value                                                                                                 |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `ruleKind`         | yes      | the kind of rule the user was trying to create, non-empty; `none (onboarding)` on the onboarding path |
| `verbatim`         | no       | the user's own words, unedited                                                                        |
| `completed`        | no       | exactly `Yes`, `No`, or `Unknown`                                                                     |
| `workedWell`       | no       | what worked well                                                                                      |
| `needsImprovement` | no       | what could use improvement                                                                            |
| `agents`           | no       | the open-source, publicly available agent(s) or framework(s) in use                                   |
| `mostValuableRule` | no       | the rule creating the most value for the team, and why                                                |

The CLI SHALL own the map from these keys to the survey's question identifiers; a payload SHALL NOT contain `$survey_*` keys. An omitted optional key SHALL be omitted from the event rather than sent as an empty string, and an optional key that is present SHALL be non-blank. The schema SHALL be embedded in the `feedback` recipe through the recipe input-schema mechanism.

#### Scenario: Optional answers are omitted, not blanked

- **WHEN** a payload has no `workedWell`
- **THEN** the `survey sent` event SHALL carry no `$survey_response_` key for that question

#### Scenario: Completion is one of three literals

- **WHEN** a payload has `completed: "partially"`
- **THEN** validation SHALL fail naming `completed`

#### Scenario: The rule kind alone is a complete response

- **WHEN** a payload is `{ "ruleKind": "ast-grep, forbid eval in TypeScript" }`
- **THEN** validation SHALL pass
- **AND** the `survey sent` event SHALL carry `$survey_id` and exactly one `$survey_response_<question id>` key

#### Scenario: A missing rule kind is rejected

- **WHEN** a payload carries every optional key and no `ruleKind`
- **THEN** validation SHALL fail naming `ruleKind`

### Requirement: The feedback and feedback-invite recipes

The CLI SHALL embed a `feedback` recipe that tells the agent it is the respondent: it records the user's reply verbatim when there is one, fills the remaining answers from its own observation of the session, writes the payload to `.taskless/.tmp-feedback.json`, runs `feedback send --from` that path, and deletes the file afterwards. The recipe SHALL embed the payload schema, SHALL NOT ask the agent to put the survey's questions to the user one by one, and SHALL NOT permit a follow-up question. It SHALL tell the agent to answer `ruleKind` with `none (onboarding)` when the surveyed recipe was `onboard`, to name only open-source, publicly available software in `agents`, and to omit `mostValuableRule` rather than ask the user for it.

The CLI SHALL embed a `feedback-invite` recipe carrying the text appended to surveyed recipes. Rendered header-less, it SHALL instruct the agent to ask the user exactly once, with the sentence "Taskless would like to know how this went. Anything you'd like to add in your own words? Reply `skip` if not, and I'll send my own notes on the session."; to treat a reply of `skip`, silence, or a reply unrelated to feedback as an omitted `verbatim` and still fetch `agent feedback`; to treat any other reply as the user's words and fetch `agent feedback`; and, only when the user explicitly asks for nothing to be sent, to run `feedback dismiss` and name the telemetry opt-out environment variables in one line. Both recipes SHALL follow the recipe conventions: a `# Topic:` header, the CLI named by its rendered invocation, and commands that exist.

#### Scenario: The appended invite carries no header

- **WHEN** the gate is open and a surveyed recipe is served
- **THEN** the appended text SHALL NOT contain a second `# Topic:` line
- **AND** SHALL name the rendered CLI invocation for both `feedback dismiss` and `agent feedback`

#### Scenario: The feedback recipe embeds the schema

- **WHEN** an agent runs `taskless agent feedback`
- **THEN** stdout SHALL open with `# Topic: feedback` and contain the JSON Schema for the payload

#### Scenario: An explicit refusal is honoured

- **WHEN** the user replies to the invite asking that nothing be sent
- **THEN** the invite SHALL direct the agent to `feedback dismiss`
- **AND** SHALL direct it to name `DO_NOT_TRACK=1` or `TASKLESS_TELEMETRY_DISABLED=1` as the switch for the rest of telemetry

#### Scenario: A skip still sends

- **WHEN** the user replies `skip` to the invite
- **THEN** the invite SHALL direct the agent to `agent feedback` rather than `feedback dismiss`
- **AND** the feedback recipe SHALL direct the agent to omit `verbatim` and send the rest
