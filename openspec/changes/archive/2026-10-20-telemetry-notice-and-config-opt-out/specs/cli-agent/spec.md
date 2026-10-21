## ADDED Requirements

### Requirement: The init recipe relays the telemetry opt-out

The `init` recipe SHALL document the `telemetry` field of the `init --json` envelope. When `telemetry.enabled` is `true`, it SHALL tell the agent to tell the user that Taskless collects anonymous telemetry and how to opt out, offering the `"telemetry": false` setting in `.taskless/taskless.json` as the project-wide switch, saying that it applies to everyone working in the repository because the file is committed, and naming the environment variables as the per-person alternative. It SHALL tell the agent to make the manifest edit only when the user asks for it. When `telemetry.enabled` is `false`, it SHALL tell the agent to say nothing about telemetry.

#### Scenario: Agent offers the opt-out after an install

- **WHEN** an agent follows the `init` recipe and the envelope reports `telemetry.enabled: true`
- **THEN** the recipe SHALL direct it to tell the user about telemetry and offer the `taskless.json` opt-out
- **AND** SHALL NOT direct it to edit the manifest unasked
