## ADDED Requirements

### Requirement: Skill routes report requests to the report topic

The skill body's topic table SHALL map a request to make, publish, regenerate, or delete a Taskless report to the `report` topic, invoked through the `%(TASKLESS_CLI)s` placeholder like every other row. The skill SHALL add no report steps of its own; the fetched recipe carries them.

#### Scenario: A report request routes to the report topic

- **WHEN** the skill body is read by an agent
- **THEN** its topic table SHALL include a row mapping report requests to `%(TASKLESS_CLI)s agent report`

#### Scenario: The skill carries no report steps

- **WHEN** the skill body is read
- **THEN** it SHALL NOT describe how to assemble, publish, or delete a report
