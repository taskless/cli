## ADDED Requirements

### Requirement: ast-grep is declared as platform packages, not a wrapper

`packages/cli` SHALL declare the ast-grep platform packages in `optionalDependencies` and SHALL NOT declare the `@ast-grep/cli` wrapper package as a runtime dependency. Every platform package SHALL be pinned to the same exact ast-grep version.

The wrapper MAY be declared as a `devDependency` where a build-time script needs its version, since a devDependency is not installed for consumers and therefore cannot affect the shipped product.

`optionalDependencies` specifically: a `devDependency` is not installed for consumers of the CLI, and a hard `dependency` would fail the install on every host the package does not match. `optional` is what allows `os`/`cpu` filtering to install exactly one package and skip the rest without error, so an unsupported host SHALL install the CLI successfully with no platform package present.

#### Scenario: Only the host-matching package installs

- **WHEN** the CLI is installed on a supported platform
- **THEN** only the ast-grep platform package matching the host's `os` and `cpu` is installed, and the binary is resolvable from the CLI's module context

#### Scenario: The wrapper is absent from what consumers install

- **WHEN** a published CLI tarball's `dependencies` and `optionalDependencies` are inspected
- **THEN** `@ast-grep/cli` is not among them, so no consumer installs it or runs its install script

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

### Requirement: Binary resolution searches all known locations before failing

Resolution SHALL search candidate locations in descending order of confidence — the host's platform package, then `node_modules/.bin`, then `sg` and `ast-grep` on `PATH` — and SHALL return the first that is an executable file. All ast-grep invocations SHALL use this single resolution path.

When no candidate yields an executable, resolution SHALL fail with an error naming the locations it tried. It SHALL NOT return a bare command name and leave the failure to surface as a spawn error.

#### Scenario: Platform package wins over a host install

- **WHEN** the platform package resolves and an unrelated ast-grep is also present on `PATH`
- **THEN** the platform package's binary is executed, because it is the version the CLI pinned

#### Scenario: A host install is used when no platform package resolves

- **WHEN** no platform package is installed for the host but ast-grep is available on `PATH`
- **THEN** resolution returns that binary and ast-grep-backed commands run normally

#### Scenario: Exhausted search fails with a useful message

- **WHEN** no candidate location yields an executable
- **THEN** resolution fails with an error naming the locations that were tried, rather than deferring to a spawn failure
