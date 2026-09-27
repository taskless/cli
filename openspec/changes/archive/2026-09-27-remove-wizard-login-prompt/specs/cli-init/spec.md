## ADDED Requirements

### Requirement: Wizard does not offer to log in

The wizard SHALL NOT prompt the user to log in, and SHALL NOT display an authentication explanation, at any step. It SHALL proceed from the tool-selection step directly to the install summary whether or not a token is available. Setup requires no account: authoring and running local rules needs none, and `taskless auth login` remains available, as do the "run `taskless auth login`" remedies on commands that require authentication.

#### Scenario: Wizard advances from tools to summary without a login prompt

- **WHEN** the wizard completes the tool-selection step and no valid token is resolvable
- **THEN** the wizard SHALL NOT display an authentication note or a login prompt
- **AND** SHALL advance to the install summary

#### Scenario: Wizard does not start the login flow

- **WHEN** the wizard runs to completion
- **THEN** it SHALL NOT call `loginInteractive()`

### Requirement: A single interactive login routine serves auth login

The CLI SHALL expose a single `loginInteractive()` function that performs the device-code login flow and returns once the token is stored or cancelled. The `auth login` subcommand SHALL call this function. No duplicate login implementation SHALL exist.

#### Scenario: Auth login uses the shared routine

- **WHEN** a user runs `taskless auth login`
- **THEN** the command handler SHALL call `loginInteractive()`

### Requirement: Cancelling the wizard writes nothing

If the user cancels the wizard at any step (Ctrl-C, Esc, or equivalent clack cancel signal) before the install step completes, the CLI SHALL NOT write any skill files, command files, or manifest updates. The CLI SHALL exit with a non-zero exit code and print a short message indicating how to resume (`taskless init`).

#### Scenario: Cancel at locations step

- **WHEN** the user cancels the wizard during the locations step
- **THEN** no files SHALL be written
- **AND** the CLI SHALL exit non-zero

#### Scenario: Cancel at summary confirm

- **WHEN** the user declines the summary confirm
- **THEN** no files SHALL be written
- **AND** the CLI SHALL exit non-zero

## REMOVED Requirements

### Requirement: Wizard explains the auth tradeoff and offers to log in

**Reason**: Every first-run question is friction, and the free tier is local-only, so asking during setup sells an account the user does not need yet (#402).

**Migration**: Run `taskless auth login` when an account is wanted. Commands that require authentication already report that and name the command.

### Requirement: Shared interactive login routine

**Reason**: Its "Wizard uses the shared routine" scenario describes the removed auth step. A MODIFIED block cannot drop a scenario, so the requirement is restated without it as "A single interactive login routine serves auth login".

**Migration**: None. `auth login` still calls `loginInteractive()`, and it is still the only login implementation.

### Requirement: Wizard cancellation aborts without filesystem writes

**Reason**: Its "Cancel at auth step" scenario describes a step that no longer exists. The requirement is restated without it as "Cancelling the wizard writes nothing".

**Migration**: None. Cancellation behavior at the remaining steps is unchanged.
