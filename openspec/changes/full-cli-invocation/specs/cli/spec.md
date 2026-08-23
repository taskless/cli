## ADDED Requirements

### Requirement: The CLI determines how it was launched from the path it was launched from

The CLI SHALL determine the command a user would type to reach it again from the shape of `process.argv[1]` together with the process environment, and SHALL expose that determination as a function that is pure over an injected context — an environment record and an argv array — so every launcher case is testable without spawning a process. This mirrors `resolveBuildTarget`, which is pure over an injected `BuildEnvironment` for the same reason.

The detection SHALL recognize two launchers:

- **npx**, identified by an `_npx` cache path segment in `argv[1]`, or by the environment reporting an `exec` command whose lifecycle event is `npx`.
- **pnpm dlx**, identified by a `pnpm/` user agent together with a `dlx` cache path segment in `argv[1]`.

The detection SHALL return "unknown" for everything else, and "unknown" SHALL be a first-class answer rather than a fallback to npx. In particular, `pnpm run`, `pnpm exec`, and pnpm lifecycle scripts all set a `pnpm/` user agent while running the CLI out of the repository's own `node_modules`; they SHALL NOT be reported as `pnpm dlx`. A bare `node` invocation, a `node_modules/.bin` shim, and a global install set no distinguishing signal and SHALL all be reported as unknown.

Yarn and bun are deliberately not detected. They are distinguishable only by the user agent, which the pnpm case demonstrates is not evidence of how the user invoked anything.

#### Scenario: An npx launch is recognized

- **WHEN** the CLI is launched by `npx` and `argv[1]` lies under the npx cache
- **THEN** detection SHALL report an npx launch

#### Scenario: A pnpm dlx launch is recognized

- **WHEN** the CLI is launched by `pnpm dlx` and `argv[1]` lies under pnpm's dlx cache
- **THEN** detection SHALL report a pnpm dlx launch

#### Scenario: A pnpm script is not mistaken for pnpm dlx

- **WHEN** the CLI runs from a `package.json` script under pnpm, with a `pnpm/` user agent and an `argv[1]` inside the repository's `node_modules`
- **THEN** detection SHALL report unknown, not pnpm dlx

#### Scenario: A bare launch is unknown

- **WHEN** the CLI is launched with no package-manager environment at all
- **THEN** detection SHALL report unknown

### Requirement: User-facing CLI invocations name the package the reader is running

Wherever the CLI prints a command for the user to run — an authentication prompt, a re-authentication hint, an error remedy — it SHALL compose that command from the detected launcher and from the package specifier of the build in hand, not from a hardcoded string.

The package specifier SHALL come from the build-target invocation, so a nightly build names `@taskless/cli-nightly` at its published version and a prod build names `@taskless/cli`. A prod specifier SHALL be pinned to `@latest` when it is handed to a launcher, since `npx` and `pnpm dlx` otherwise prefer whatever is already cached. A build whose invocation is a filesystem path (`dev`, `self`) SHALL be printed verbatim, since no launcher applies to it.

Where detection reports unknown, the printed command SHALL name `npx` with the correct package specifier. That is a display default for a human reader who needs something runnable, and it is distinct from the recipe renderer's marker, which is read by an agent that can be asked to supply the right answer.

#### Scenario: A nightly names itself in an error message

- **WHEN** a nightly build prints an authentication remedy
- **THEN** the printed command SHALL name `@taskless/cli-nightly` at the nightly's own version, not `@taskless/cli`

#### Scenario: A pnpm script no longer suggests pnpm dlx

- **WHEN** the CLI runs from a `package.json` script under pnpm and prints an authentication remedy
- **THEN** the printed command SHALL NOT suggest `pnpm dlx`, because that is not how the reader reached the CLI
