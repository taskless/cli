## MODIFIED Requirements

### Requirement: User-facing CLI invocations name the package the reader is running

Wherever the CLI prints a command for the user to run — an authentication prompt, a re-authentication hint, an error remedy — it SHALL compose that command from the detected launcher and from the package specifier of the build in hand, not from a hardcoded string.

The package specifier SHALL come from the build-target invocation, so a nightly build names `@taskless/cli-nightly` at its published version and a prod build names `@taskless/cli` at its released version. Neither SHALL be handed to a launcher as `@latest` or unpinned: the printed command runs the version the project installed, which is also the version its permission rules allow. A build whose invocation is a filesystem path (`dev`, `self`) SHALL be printed verbatim, since no launcher applies to it.

Where detection reports unknown, the printed command SHALL name `npx` with the correct package specifier. That is a display default for a human reader who needs something runnable, and it is distinct from the recipe renderer's marker, which is read by an agent that can be asked to supply the right answer.

#### Scenario: A nightly names itself in an error message

- **WHEN** a nightly build prints an authentication remedy
- **THEN** the printed command SHALL name `@taskless/cli-nightly` at the nightly's own version, not `@taskless/cli`

#### Scenario: A release names its own version

- **WHEN** a prod build prints an authentication remedy
- **THEN** the printed command SHALL name `@taskless/cli@<version>` at the build's own version
- **AND** SHALL NOT name `@taskless/cli@latest`

#### Scenario: A pnpm script no longer suggests pnpm dlx

- **WHEN** the CLI runs from a `package.json` script under pnpm and prints an authentication remedy
- **THEN** the printed command SHALL NOT suggest `pnpm dlx`, because that is not how the reader reached the CLI
