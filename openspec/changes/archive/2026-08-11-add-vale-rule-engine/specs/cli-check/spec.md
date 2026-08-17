## ADDED Requirements

### Requirement: Check runs engines concurrently and merges their results

`taskless check` SHALL run its per-engine executors concurrently and merge their `CheckResult`s into a single result set. A missing or unavailable engine SHALL NOT abort the others; its absence SHALL be reported while the remaining engines still produce results.

#### Scenario: ast-grep and Vale run concurrently and merge

- **WHEN** `.taskless/sg/` and `.taskless/vale/` both contain rules
- **THEN** the CLI runs both engines concurrently and returns one merged result set whose findings count toward the exit code identically

#### Scenario: One engine unavailable, others proceed

- **WHEN** the `vale` binary is unavailable but `.taskless/sg/` has rules
- **THEN** the CLI reports the Vale engine as unavailable and still returns ast-grep results
