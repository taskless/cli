## REMOVED Requirements

### Requirement: A survey invite is appended to surveyed recipes when the gate is open

**Reason**: `onboard` leaves the surveyed recipes. Its user agrees to onboarding feedback with the opening yes, so the recipe sends that feedback itself, and the requirement's scenario that both onboarding paths carry the invite no longer holds. A MODIFIED block cannot drop that scenario.

**Migration**: Replaced by "A survey invite is appended to surveyed rule-authoring recipes when the gate is open", which carries every other scenario unchanged and adds that onboarding carries no invite. Onboarding feedback is covered by "Onboarding feedback is sent without an invite".

## ADDED Requirements

### Requirement: A survey invite is appended to surveyed rule-authoring recipes when the gate is open

When the CLI serves one of the surveyed recipes (`create-sg-rule`, `create-vale-rule`, `create-remote-rule`) through `taskless agent <topic>`, it SHALL append the survey invite to the served text if and only if every gate condition holds:

- telemetry is enabled (neither `DO_NOT_TRACK=1` nor `TASKLESS_TELEMETRY_DISABLED=1`);
- `CI` is neither `"true"` nor `"1"`;
- the survey's `next_ask` timestamp is absent, unparseable, or not later than now.

When the gate is open the CLI SHALL capture `survey shown` with `$survey_id`, write `next_ask` to now plus 10 days, and append the invite after the recipe's last section. When any condition fails the served text SHALL be byte-identical to the recipe as rendered without a survey. The `@taskless/cli/prompts` export SHALL never include the invite.

`onboard` is not a surveyed recipe. Its user agreed to onboarding feedback with their opening yes, so the onboarding recipe sends that feedback itself, and an invite appended to it would ask a question that has already been answered.

#### Scenario: Gate open on a surveyed topic

- **WHEN** telemetry is enabled, `CI` is unset, `next_ask` is absent, and an agent runs `taskless agent create-sg-rule`
- **THEN** stdout SHALL be the `create-sg-rule` recipe followed by the survey invite
- **AND** PostHog SHALL receive `survey shown` with `$survey_id`
- **AND** `next_ask` SHALL be written to a time about 10 days in the future

#### Scenario: Onboarding carries no invite

- **WHEN** the gate would otherwise be open and either `taskless onboard` or `taskless agent onboard` serves the onboarding recipe
- **THEN** stdout SHALL be the recipe with no invite
- **AND** no survey event SHALL be captured and `next_ask` SHALL be unchanged

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

### Requirement: Onboarding feedback is sent without an invite

The `rule-feedback` recipe SHALL support being reached from the onboarding recipe rather than from an invite. Reached that way, the agent SHALL omit `verbatim`, answer `ruleKind` with `none (onboarding)`, fill every other answer from its own observation of the session, and send without asking the user anything. `feedback send` SHALL continue to honor the telemetry opt-out, so a user with `DO_NOT_TRACK=1` or `TASKLESS_TELEMETRY_DISABLED=1` sends nothing.

#### Scenario: Onboarding sends feedback unprompted

- **WHEN** the agent reaches `rule-feedback` from the onboarding recipe
- **THEN** the recipe SHALL direct it to send the payload without putting a question to the user
- **AND** `ruleKind` SHALL be `none (onboarding)`

#### Scenario: The opt-out still holds

- **WHEN** `DO_NOT_TRACK=1` and the agent runs `feedback send` at the end of onboarding
- **THEN** nothing SHALL be sent
