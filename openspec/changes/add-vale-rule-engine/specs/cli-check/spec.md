## ADDED Requirements

### Requirement: Check runs engines concurrently and merges their results

`taskless check` SHALL run its per-engine executors concurrently and merge their `CheckResult`s into a single result set. A missing or unavailable engine SHALL NOT abort the others; its absence SHALL be reported while the remaining engines still produce results.

#### Scenario: ast-grep and Vale run concurrently and merge

- **WHEN** `.taskless/sg/` and `.taskless/vale/` both contain rules
- **THEN** the CLI runs both engines concurrently and returns one merged result set whose findings count toward the exit code identically

#### Scenario: One engine unavailable, others proceed

- **WHEN** the `vale` binary is unavailable but `.taskless/sg/` has rules
- **THEN** the CLI reports the Vale engine as unavailable and still returns ast-grep results

## MODIFIED Requirements

### Requirement: Check subcommand executes ast-grep scan

The CLI SHALL execute `sg scan --config .taskless/sg/sgconfig.yml --json=stream` using `child_process.spawn` with `shell: true` for cross-platform binary resolution, reading the **committed** ast-grep config at `.taskless/sg/sgconfig.yml`. No `sgconfig.yml` is generated at check time. The `sg` binary SHALL be resolved from the `@ast-grep/cli` dependency via PATH. Reconciliation/run-set semantics for runtime rules are unchanged.

#### Scenario: ast-grep scan runs with the committed config

- **WHEN** the CLI executes the ast-grep scanner
- **THEN** it SHALL invoke `sg scan` with `--config .taskless/sg/sgconfig.yml` and `--json=stream`
- **AND** it SHALL NOT write or generate a config file
- **AND** the working directory for the spawned process SHALL be the resolved project directory

#### Scenario: ast-grep binary is not found

- **WHEN** the `sg` binary cannot be resolved from PATH
- **THEN** the CLI SHALL print an error message indicating ast-grep is not available
- **AND** the CLI SHALL exit with code 1

### Requirement: Check dispatches static and runtime rules to distinct executors

`taskless check` SHALL dispatch rules to distinct executors by their engine directory: **ast-grep** rules under `.taskless/sg/` via the ast-grep scanner, **Vale** rules under `.taskless/vale/` via the Vale runner (per the `cli-vale-rule-engine` capability), and **runtime** rules under `.taskless/runtime/rules/` via the runtime harness (per the `cli-runtime-rule-execution` capability). Findings from all executors SHALL be aggregated into the same result set and SHALL count toward the exit code identically.

#### Scenario: Mixed corpus runs all executors

- **WHEN** `.taskless/sg/` contains ast-grep rules, `.taskless/vale/` contains Vale rules, and `.taskless/runtime/rules/` contains runtime rules
- **THEN** the CLI SHALL run ast-grep rules through `sg scan`, Vale rules through the Vale runner, and runtime rules through the runtime harness
- **AND** SHALL merge their findings into one result set

## REMOVED Requirements

### Requirement: Check subcommand generates ephemeral sgconfig.yml

**Reason**: Engine configs are now committed per-engine directory (`.taskless/sg/sgconfig.yml`), not generated at check time — check reads the committed config directly.

**Migration**: Migration `0004` moves the existing `.taskless/sgconfig.yml` to `.taskless/sg/sgconfig.yml` (its relative `ruleDirs: [rules]` remains valid). No config is written at check time thereafter.
