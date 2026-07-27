## ADDED Requirements

### Requirement: ast-grep is declared as platform packages, not a wrapper

`packages/cli` SHALL declare the ast-grep platform packages in `optionalDependencies` and SHALL NOT depend on the `@ast-grep/cli` wrapper package. Every platform package SHALL be pinned to the same exact ast-grep version.

An unsupported host SHALL install the CLI successfully with no platform package present.

#### Scenario: Only the host-matching package installs

- **WHEN** the CLI is installed on a supported platform
- **THEN** only the ast-grep platform package matching the host's `os` and `cpu` is installed, and the binary is resolvable from the CLI's module context

#### Scenario: The wrapper is absent

- **WHEN** the CLI's dependencies are inspected
- **THEN** `@ast-grep/cli` is not among them

#### Scenario: Platform packages stay in lockstep

- **WHEN** the declared ast-grep platform packages are inspected
- **THEN** every one is pinned to the same exact version, so no two hosts run different ast-grep versions against the same rules

#### Scenario: Unsupported platform still installs

- **WHEN** the CLI is installed on a platform with no published ast-grep package
- **THEN** the install succeeds with no platform package present and no install-time error

### Requirement: The ast-grep binary requires no install-time step

The ast-grep binary SHALL be usable purely by dependency resolution. Its availability SHALL NOT depend on a dependency lifecycle script having run, and SHALL NOT depend on any file having been copied or linked into another package at install time.

#### Scenario: Binary is available with lifecycle scripts disabled

- **WHEN** the CLI is installed with dependency lifecycle scripts disabled
- **THEN** the ast-grep binary is present and executable, and every ast-grep-backed command runs

#### Scenario: Isolated installs resolve the real binary

- **WHEN** the CLI is executed from an install with strict dependency isolation, such as `pnpm dlx`
- **THEN** the resolved path is the real executable, never a placeholder file

### Requirement: Binary resolution prefers the platform package over PATH

Resolution SHALL attempt the platform package first and fall back to `PATH` only when it cannot be resolved. All ast-grep invocations SHALL use this single resolution path.

#### Scenario: Platform package wins over a host install

- **WHEN** the platform package resolves and an unrelated ast-grep is also present on `PATH`
- **THEN** the platform package's binary is executed

#### Scenario: Fallback covers an unresolvable platform package

- **WHEN** no platform package resolves for the host
- **THEN** resolution falls back to `PATH`, and the engine reports itself unavailable if nothing is found there
