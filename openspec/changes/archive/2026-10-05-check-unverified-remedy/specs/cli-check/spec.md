## ADDED Requirements

### Requirement: Check names the remedy when rules run unverified

Whenever `taskless check` runs rules without verifying them, because `--anonymous` is set,
no token is available, no GitHub repository URL resolves, or reconciliation cannot complete,
it SHALL emit exactly one notice that says the rules were not verified, states the cause, and
names what would let verification happen. The notice SHALL be emitted whether or not the
project has runtime rules. It SHALL NOT change the exit code. It SHALL be a single line, cause
and remedy together, so that under `--json` it is one entry in the `notices` array; in human
output it SHALL be written to stderr marked as a notice. `--dangerously-run-scripts` is excluded: it carries its own warning.

The remedy SHALL be specific to the cause:

- `--anonymous`: run `check` without `--anonymous`.
- No token: `taskless auth login`, or a `TASKLESS_TOKEN` where `check` runs in CI.
- No repository URL: which of the three problems applies (not a git repository, no `origin`
  remote, or an `origin` that is not GitHub) and the step for that problem.
- A rejected token: re-authenticate with `taskless auth login`, or replace the token.
- `404 organization_not_found`: the same steps `rule create` gives for that code, confirming
  the Taskless GitHub App installation covers the repository and re-authenticating with
  `taskless auth login`.

#### Scenario: Logged out with no runtime rules still says so

- **WHEN** a user runs `taskless check` with no available token in a project with no runtime rules
- **THEN** the CLI SHALL emit one notice that the rules were not verified
- **AND** the notice SHALL name `auth login`
- **AND** the exit code SHALL NOT change because of the notice

#### Scenario: Anonymous names the flag, not authentication

- **WHEN** a user runs `taskless check --anonymous`
- **THEN** the notice SHALL name `--anonymous` as the cause and running without it as the remedy

#### Scenario: A missing origin is named as such

- **WHEN** an authenticated `check` runs in a git repository with no `origin` remote
- **THEN** the notice SHALL say the repository has no `origin` remote and how to add one

#### Scenario: Organization not found carries the installation remedy

- **WHEN** reconciliation returns `404 organization_not_found`
- **THEN** the notice SHALL name confirming the Taskless GitHub App installation and re-authenticating with `auth login`

#### Scenario: The notice is a notices entry under --json

- **WHEN** `taskless check --json` runs unverified
- **THEN** the `notices` array SHALL contain the notice
- **AND** `success`, `results`, and `skipped` SHALL keep their existing meaning

## MODIFIED Requirements

### Requirement: Check accepts --anonymous as a no-op

The `taskless check` command SHALL accept the global `--anonymous` flag (per the `cli`
capability). Because `check` reconciles against the Taskless API when authenticated,
`--anonymous` SHALL force the logged-out path: it SHALL suppress the reconcile network call
and run all local static rules. Aside from forcing the logged-out path, `--anonymous` SHALL NOT
change scan behavior, output shape, or exit codes relative to an unauthenticated `check`. The
not-verified notice SHALL name `--anonymous` as its cause rather than authentication.

#### Scenario: check --anonymous skips reconciliation

- **WHEN** a user runs `taskless check --anonymous`
- **THEN** the CLI SHALL NOT call `POST /cli/api/v2/reconcile`
- **AND** SHALL scan all local static rules

#### Scenario: check --anonymous matches an unauthenticated check

- **WHEN** a user runs `taskless check --anonymous`
- **THEN** its scan behavior, output shape, and exit code SHALL match `taskless check` run with
  no available token
- **AND** only the cause and remedy named in the not-verified notice SHALL differ

### Requirement: Check selects what it runs from auth state

`taskless check` SHALL NOT require authentication, and it SHALL choose what it verifies from
the current auth state. When a token is available and `--anonymous` is not set, the CLI SHALL
reconcile **every** rule (ast-grep, Vale, and runtime) and apply the verdict policy of the
`cli-rule-reconciliation` capability. When no token is available, when `--anonymous` is set, or
when reconciliation cannot complete, the CLI SHALL run every static rule (ast-grep and Vale)
unverified and SHALL skip runtime execution unless `--dangerously-run-scripts` is set. The
unauthenticated path SHALL succeed with no network access. It SHALL report that the rules were
not verified as an informational notice ("Check names the remedy when rules run unverified"),
and SHALL NOT fail or change the exit code because no token is available.

#### Scenario: Unauthenticated check runs static rules and skips runtime rules

- **WHEN** a user runs `taskless check` with no available token
- **THEN** the CLI SHALL scan all static rules
- **AND** SHALL NOT call `POST /cli/api/v2/reconcile`
- **AND** SHALL skip runtime rules
- **AND** SHALL emit the not-verified notice naming `auth login`, without changing the exit code

#### Scenario: Authenticated check reconciles runtime rules

- **WHEN** a user runs `taskless check` with an available token and without `--anonymous`
- **THEN** the CLI SHALL reconcile its ast-grep, Vale, and runtime rules in one request
- **AND** SHALL run or execute each rule according to its verdict

#### Scenario: Anonymous forces the logged-out path

- **WHEN** a user runs `taskless check --anonymous` while a token is available
- **THEN** the CLI SHALL behave exactly as an unauthenticated `check` (static rules run, runtime rules skipped, no reconcile call)

#### Scenario: Logged out, an edited static rule still runs

- **WHEN** a user runs `taskless check` with no available token and an issued sg or vale rule has been edited
- **THEN** the edited rule SHALL run with no signature enforcement
- **AND** runtime rules SHALL be skipped
- **AND** the exit code SHALL NOT change because the rule was edited

#### Scenario: Logged in, an edited rule of any engine does not run

- **WHEN** an authenticated `check` reconciles and a rule of any engine is `unsafe`
- **THEN** that rule SHALL NOT run or execute
