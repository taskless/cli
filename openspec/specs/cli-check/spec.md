# CLI Check

## Purpose

The `taskless check` subcommand: how it validates a project's setup and runs the configured engines across the repository to report rule violations.

## Requirements

### Requirement: Check subcommand works without taskless.json

The `check` command SHALL NOT require `.taskless/taskless.json` to exist. The command SHALL only require the presence of ast-grep rule files, in the `sg` engine directory `.taskless/sg/rules/` or the pre-migration `.taskless/rules/`.

#### Scenario: Check succeeds without taskless.json

- **WHEN** a user runs `taskless check` in a directory with `.taskless/sg/rules/*.yml` files but no `taskless.json`
- **THEN** the CLI SHALL run the scanner against the committed `.taskless/sg/sgconfig.yml`

#### Scenario: Check exits cleanly with no .taskless/ directory

- **WHEN** a user runs `taskless check` in a directory without a `.taskless/` directory
- **THEN** the CLI SHALL print a message: "No rules configured. Create one with `taskless rule create`."
- **AND** the CLI SHALL exit with code 0

#### Scenario: Check exits cleanly with empty rules directory

- **WHEN** a user runs `taskless check` and no engine directory holds any rule files
- **THEN** the CLI SHALL print a warning that no rules were found
- **AND** the CLI SHALL exit with code 0

### Requirement: Check subcommand warns when no rules exist

The CLI SHALL check for the presence of YAML rule files in the `sg` engine directory `.taskless/sg/rules/`, and in the pre-migration `.taskless/rules/` where a project has not been migrated. When no rule files are found in either, the CLI SHALL warn the user and exit cleanly.

#### Scenario: No rule files in any rules directory

- **WHEN** a user runs `taskless check` and neither `.taskless/sg/rules/` nor `.taskless/rules/` contains `.yml` files
- **THEN** the CLI SHALL print a warning message indicating no rules were found
- **AND** the CLI SHALL exit with code 0

#### Scenario: Engine rules directory contains rule files

- **WHEN** a user runs `taskless check` and `.taskless/sg/rules/` contains one or more `.yml` files
- **THEN** the CLI SHALL proceed to run the scanner

#### Scenario: Only the pre-migration rules directory contains rule files

- **WHEN** a user runs `taskless check` and only `.taskless/rules/` contains `.yml` files
- **THEN** the CLI SHALL run the scanner against a generated config for that layout, so an unmigrated rule set still runs

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

### Requirement: Check subcommand maps ast-grep output to CheckResult

The CLI SHALL parse the JSONL stream from `sg scan --json=stream` and map each match object to an internal `CheckResult` type. The `CheckResult` type SHALL include: `source` (string), `ruleId` (string), `severity` ("error" | "warning" | "info" | "hint"), `message` (string), `note` (optional string), `file` (string), `range` (start/end with line and column), `matchedText` (string), and `fix` (optional string).

#### Scenario: ast-grep match is mapped to CheckResult

- **WHEN** ast-grep outputs a JSON match object with `ruleId`, `severity`, `message`, `text`, `file`, and `range`
- **THEN** the CLI SHALL produce a `CheckResult` with `source` set to `"ast-grep"` and all other fields mapped from the match object

#### Scenario: ast-grep match with note and fix

- **WHEN** ast-grep outputs a match with `note` and `replacement` fields
- **THEN** the `CheckResult` SHALL include the `note` and `fix` values

### Requirement: Check subcommand formats human-readable output by default

When the `--json` flag is not set, the CLI SHALL format `CheckResult` items as human-readable diagnostic output to stdout. Each result SHALL display the file path with line and column, severity and rule ID, message, matched source text, and optional note.

#### Scenario: Human output for a single error

- **WHEN** the scanner produces one error-severity result in `src/utils.ts` at line 42 column 5
- **THEN** stdout SHALL include the file location, severity tag, rule ID, message, and matched text in a readable format

#### Scenario: Human output summary

- **WHEN** the scanner completes with results
- **THEN** stdout SHALL include a summary line with the count of issues by severity and the number of files scanned

#### Scenario: Human output with no issues found

- **WHEN** the scanner completes with zero results
- **THEN** stdout SHALL indicate that no issues were found

### Requirement: Check subcommand formats JSON output when --json is set

When the `--json` flag is set, the CLI SHALL output each `CheckResult` as a JSON object per line (JSONL format) to stdout.

#### Scenario: JSON output streams results

- **WHEN** the `--json` flag is set and the scanner produces results
- **THEN** each `CheckResult` SHALL be written as a single-line JSON object to stdout, one per line

#### Scenario: JSON output with no issues

- **WHEN** the `--json` flag is set and the scanner produces zero results
- **THEN** stdout SHALL contain no output lines

### Requirement: Check subcommand exit codes reflect error severity

The CLI SHALL exit with code 0 when no error-severity matches are found (including when only warnings, info, or hints exist) and no reconcile outcome below requires failure. The CLI SHALL exit with code 1 when at least one error-severity match is found. The CLI SHALL also exit with code 1, whatever the findings and in both human and `--json` modes, when a completed reconcile:

- returned a non-empty `entitlement.withheld`;
- returned an `unsafe` verdict for an `sg` or `vale` rule; or
- left a reported rule unaccounted for (in none, or more than one, of `rules`, `unknown`, and `entitlement.withheld`).

On an authenticated run that would reconcile, the CLI SHALL also exit with code 1 when two rule directories under different engines share an id. A logged-out run verifies nothing and does not fail on it. Under `--json`, `success` SHALL be `false` whenever the exit code is non-zero.

#### Scenario: Exit 0 when clean

- **WHEN** the scanner produces zero results
- **THEN** the process SHALL exit with code 0

#### Scenario: Exit 0 when only warnings

- **WHEN** the scanner produces results but none have severity "error"
- **THEN** the process SHALL exit with code 0

#### Scenario: Exit 1 when errors found

- **WHEN** the scanner produces at least one result with severity "error"
- **THEN** the process SHALL exit with code 1

#### Scenario: Exit 1 when a runtime rule is withheld for entitlement

- **WHEN** reconciliation returns a non-empty `entitlement.withheld` and the scan produces zero results
- **THEN** the process SHALL exit with code 1
- **AND** under `--json`, `success` SHALL be `false`

#### Scenario: Entitlement without a withheld file does not fail

- **WHEN** reconciliation returns `entitlement.runtimeSignatures: false` with an empty or absent `withheld`, and the scan produces zero results
- **THEN** the process SHALL exit with code 0

#### Scenario: Exit 1 when a static rule was edited

- **WHEN** reconciliation returns an `unsafe` verdict for an `sg` or `vale` rule and the scan produces zero results
- **THEN** the process SHALL exit with code 1

#### Scenario: Exit 1 when a reported rule is unaccounted for

- **WHEN** a reported rule appears in none of `rules`, `unknown`, and `entitlement.withheld`
- **THEN** the process SHALL exit with code 1

#### Scenario: Missing does not fail

- **WHEN** reconciliation returns only `run` and `missing` verdicts and the scan produces zero results
- **THEN** the process SHALL exit with code 0

### Requirement: Check subcommand respects global working directory flag

The `check` subcommand SHALL use the resolved working directory from the global `-d` flag (or `process.cwd()` if not specified) as the target directory for `.taskless/` validation and scanner execution.

#### Scenario: Check uses custom directory

- **WHEN** a user runs `taskless check -d /path/to/repo`
- **THEN** `.taskless/` validation and scanning SHALL operate on `/path/to/repo`

#### Scenario: Check defaults to current directory

- **WHEN** a user runs `taskless check` without `-d`
- **THEN** `.taskless/` validation and scanning SHALL operate on `process.cwd()`

### Requirement: Check accepts positional path arguments

The `check` subcommand SHALL accept zero or more positional path arguments. When zero paths are passed, the CLI SHALL scan the full project directory (existing behavior). When one or more paths are passed, the CLI SHALL forward those paths to `sg scan` so that only the specified files and directories are scanned. Paths SHALL be treated relative to the resolved working directory (`-d` / `process.cwd()`).

Before forwarding, the CLI SHALL silently drop any path that does not exist on disk at invocation time. This lets CI pipelines pipe raw git-diff output directly (e.g. `taskless check $(git diff --name-only main...HEAD)`) without pre-filtering deleted files. If every supplied path is filtered out and the original argument list was non-empty, the CLI SHALL exit with code 0 and print no matches (interpreted as "nothing changed, nothing to scan").

#### Scenario: Zero path arguments scans the whole project

- **WHEN** a user runs `taskless check`
- **THEN** `sg scan` SHALL be invoked without any trailing path arguments
- **AND** the scan SHALL cover the entire resolved working directory

#### Scenario: Explicit paths limit the scan

- **WHEN** a user runs `taskless check src/foo.ts src/bar.ts`
- **AND** both files exist on disk
- **THEN** `sg scan` SHALL be invoked with `src/foo.ts` and `src/bar.ts` as trailing arguments
- **AND** the scan SHALL NOT include files outside those two paths

#### Scenario: Non-existent paths are silently filtered

- **WHEN** a user runs `taskless check src/present.ts src/deleted.ts`
- **AND** `src/present.ts` exists but `src/deleted.ts` does not
- **THEN** the CLI SHALL forward only `src/present.ts` to `sg scan`
- **AND** SHALL NOT error on the missing path

#### Scenario: All paths filtered out exits cleanly

- **WHEN** a user runs `taskless check src/deleted-a.ts src/deleted-b.ts`
- **AND** neither file exists on disk
- **THEN** the CLI SHALL exit with code 0
- **AND** SHALL NOT invoke `sg scan`
- **AND** SHALL report no results (empty results array in JSON mode)

#### Scenario: Relative paths resolve against the working directory

- **WHEN** a user runs `taskless check -d /path/to/project src/foo.ts`
- **AND** `/path/to/project/src/foo.ts` exists
- **THEN** the CLI SHALL treat `src/foo.ts` as relative to `/path/to/project`
- **AND** SHALL forward that relative path to `sg scan` with `cwd = /path/to/project`

#### Scenario: Directory paths are accepted

- **WHEN** a user runs `taskless check src/`
- **AND** `src/` is a directory
- **THEN** the CLI SHALL forward `src/` to `sg scan`
- **AND** the scan SHALL cover files under that directory

### Requirement: Check accepts --anonymous as a no-op

The `taskless check` command SHALL accept the global `--anonymous` flag (per the `cli`
capability). Because `check` reconciles against the Taskless API when authenticated,
`--anonymous` SHALL force the logged-out path: it SHALL suppress the reconcile network call
and run all local static rules. Aside from forcing the logged-out path, `--anonymous` SHALL NOT
change scan behavior, output shape, or exit codes relative to an unauthenticated `check`.

#### Scenario: check --anonymous skips reconciliation

- **WHEN** a user runs `taskless check --anonymous`
- **THEN** the CLI SHALL NOT call `POST /cli/api/v2/reconcile`
- **AND** SHALL scan all local static rules

#### Scenario: check --anonymous matches an unauthenticated check

- **WHEN** a user runs `taskless check --anonymous`
- **THEN** its scan behavior, output, and exit code SHALL match `taskless check` run with no
  available token

### Requirement: Check error output uses standardized error envelope

When `taskless check --json` exits with an error, the output SHALL conform to the standardized error envelope `{ "ok": false, "code": "<CODE>", "message": "<...>" }` per the `cli` capability requirements. Existing success-shape requirements for `--json` are unchanged.

#### Scenario: check --json error uses standardized envelope

- **WHEN** `taskless check --json` fails (e.g. ast-grep invocation error)
- **THEN** stdout SHALL contain a JSON object matching the standardized error envelope
- **AND** SHALL include a stable `code` field (e.g. `SCAN_FAILED` if added to the enum)

### Requirement: Check selects what it runs from auth state

`taskless check` SHALL NOT require authentication, and it SHALL choose what it verifies from
the current auth state. When a token is available and `--anonymous` is not set, the CLI SHALL
reconcile **every** rule (ast-grep, Vale, and runtime) and apply the verdict policy of the
`cli-rule-reconciliation` capability. When no token is available, when `--anonymous` is set, or
when reconciliation cannot complete, the CLI SHALL run every static rule (ast-grep and Vale)
unverified and SHALL skip runtime execution unless `--dangerously-run-scripts` is set. The
unauthenticated path SHALL succeed with no network access and SHALL NOT emit a warning about
missing authentication.

#### Scenario: Unauthenticated check runs static rules and skips runtime rules

- **WHEN** a user runs `taskless check` with no available token
- **THEN** the CLI SHALL scan all static rules
- **AND** SHALL NOT call `POST /cli/api/v2/reconcile`
- **AND** SHALL skip runtime rules
- **AND** SHALL NOT emit a warning about missing authentication

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

### Requirement: Check reconciles rule files before scanning

`taskless check` SHALL reconcile before running any rule whenever a bearer token and a
`repositoryUrl` are resolvable and `--anonymous` is not set. It SHALL snapshot the rules tree,
report every rule directory from the snapshot to `POST /cli/api/v2/reconcile` (per the
`cli-rule-reconciliation` capability), remove from the snapshot every rule its verdict
excludes, and only then assemble engine configs and run.

#### Scenario: Only rules with a blessed check.ts execute

- **WHEN** a user runs `taskless check` while authenticated and reconciliation returns `run` for some rules, `unsafe` for a static rule, and `unknown` for a runtime rule
- **THEN** the CLI SHALL run the `run` rules
- **AND** SHALL NOT run the `unsafe` static rule
- **AND** SHALL NOT execute the `unknown` runtime rule

### Requirement: Check degrades to a local scan when reconciliation cannot complete

`taskless check` SHALL NOT fail solely because an attempted reconciliation cannot complete.
When a token is available and `--anonymous` is not set but reconciliation cannot complete (no
resolvable git remote, the endpoint unreachable, a `401`, a `404 organization_not_found`, or a
transport error), the CLI SHALL warn that rule verification could not be performed, SHALL run
every **static** rule from the snapshot unverified, and SHALL **skip runtime rules** unless
`--dangerously-run-scripts` is set. The CLI SHALL NOT exit with a non-zero code solely because
reconciliation failed, and the warning SHALL be suppressed under `--json`.

#### Scenario: Endpoint unreachable degrades static and skips runtime

- **WHEN** an authenticated `check` attempts reconciliation and the endpoint is unreachable or returns an error
- **THEN** the CLI SHALL warn that verification could not be performed
- **AND** SHALL scan all static rules
- **AND** SHALL NOT execute any runtime rule's `check.ts`
- **AND** SHALL NOT exit with a non-zero code solely due to the reconcile failure

#### Scenario: Degrade warning is suppressed under --json

- **WHEN** the CLI degrades and `--json` is set
- **THEN** stdout SHALL contain the machine JSON shape (`{ success, results }` plus the additive optional `skipped` array for the skipped runtime rules)
- **AND** SHALL NOT contain the human-readable degrade warning

### Requirement: Check dispatches static and runtime rules to distinct executors

`taskless check` SHALL dispatch rules to distinct executors by their engine directory: **ast-grep** rules under `.taskless/rules/sg/` via the ast-grep scanner, **Vale** rules under `.taskless/rules/vale/` via the Vale runner (per the `cli-vale-rule-engine` capability), and **runtime** rules under `.taskless/rules/runtime/` via the runtime harness (per the `cli-runtime-rule-execution` capability). Findings from all executors SHALL be aggregated into the same result set and SHALL count toward the exit code identically.

#### Scenario: Mixed corpus runs all executors

- **WHEN** `.taskless/rules/sg/` contains ast-grep rules, `.taskless/rules/vale/` contains Vale rules, and `.taskless/rules/runtime/` contains runtime rules
- **THEN** the CLI SHALL run ast-grep rules through `sg scan`, Vale rules through the Vale runner, and runtime rules through the runtime harness
- **AND** SHALL merge their findings into one result set

### Requirement: Check runs runtime rules only on a signature-validated path

`taskless check` SHALL execute a runtime rule's `check.ts` only when reconciliation returned a
`run` verdict for that rule, or when `--dangerously-run-scripts` is set. An API key SHALL be
treated identically to an interactive token. On any path where the rule was not validated —
logged out, `--anonymous`, a reconciliation that cannot complete, or a verdict other than
`run` — the CLI SHALL NOT execute the rule's `check.ts`.

#### Scenario: Authenticated check runs blessed runtime rules

- **WHEN** an authenticated `check` reconciles and a runtime rule's verdict is `run`
- **THEN** the CLI SHALL execute that runtime rule through the harness

#### Scenario: A rule whose check.ts is not blessed is withheld

- **WHEN** reconciliation returns `unsafe` for a runtime rule, lists it in `unknown`, or withholds it for entitlement
- **THEN** the CLI SHALL NOT execute that runtime rule
- **AND** SHALL report it as skipped with a reason naming the verdict

#### Scenario: API key behaves like a token

- **WHEN** `check` runs with an API key
- **THEN** the CLI SHALL reconcile and run validated runtime rules exactly as with an interactive token

### Requirement: Check skips runtime rules on unverified paths and reports the skip

`taskless check` SHALL skip a runtime rule's execution when it cannot validate the rule's
signature — logged out, `--anonymous`, or reconciliation cannot complete — and
`--dangerously-run-scripts` is not set. It SHALL report that runtime rules exist and were not
run, SHALL still run static rules on these paths, and SHALL NOT change the exit code because
rules were skipped. In human output the report SHALL be a notice; under `--json` it SHALL be an
additive, optional `skipped` array of `{ rule, reason }`, leaving the existing `success` and
`results` fields unchanged, so machine callers (for example CI) can detect that runtime rules
did not run.

#### Scenario: Logged-out check skips runtime rules

- **WHEN** a user runs `taskless check` with no available token and runtime rules are present
- **THEN** the CLI SHALL run static rules
- **AND** SHALL NOT execute any runtime rule's `check.ts`
- **AND** SHALL report that the runtime rules were skipped
- **AND** SHALL NOT change the exit code because rules were skipped

#### Scenario: Skipped runtime rules appear under --json

- **WHEN** runtime rules are skipped and `--json` is set
- **THEN** stdout SHALL include a `skipped` array of `{ rule, reason }` alongside the unchanged `success` and `results` fields

#### Scenario: Anonymous skips runtime rules while authenticated

- **WHEN** a user runs `taskless check --anonymous` while a token is available
- **THEN** the CLI SHALL skip runtime rules exactly as an unauthenticated `check`

### Requirement: Check accepts --dangerously-run-scripts to run runtime rules without server validation

`taskless check` SHALL accept a `--dangerously-run-scripts` flag that runs **all** rules without
server validation, regardless of auth state.
When the flag is set the CLI SHALL NOT reconcile — it SHALL skip the network entirely (matching
how `--anonymous` forces the no-network path), SHALL compute and enforce no signatures for any
engine, run every present static rule, and execute every present runtime rule. The CLI SHALL
emit a prominent warning that runtime rule code is being executed unverified. The flag SHALL be
the only way to execute runtime rules on an unverified path.

#### Scenario: Dangerously-run-scripts executes runtime rules offline

- **WHEN** a user runs `taskless check --dangerously-run-scripts` with no available token
- **THEN** the CLI SHALL execute the present runtime rules' `check.ts`
- **AND** SHALL emit a warning that runtime rule code ran unverified

#### Scenario: Warning is suppressed under --json

- **WHEN** `--dangerously-run-scripts` and `--json` are both set
- **THEN** stdout SHALL contain only the existing `{ success, results }` JSON shape
- **AND** the unverified-execution warning SHALL NOT appear in stdout

#### Scenario: No signature is enforced while logged in

- **WHEN** an authenticated user runs `taskless check --dangerously-run-scripts` and an issued vale rule has been edited
- **THEN** the CLI SHALL NOT call reconcile
- **AND** the edited rule SHALL run
- **AND** the exit code SHALL NOT change because the rule was edited

### Requirement: Check runs engines concurrently and merges their results

`taskless check` SHALL run its per-engine executors concurrently and merge their `CheckResult`s into a single result set. A missing or unavailable engine SHALL NOT abort the others; its absence SHALL be reported while the remaining engines still produce results.

#### Scenario: ast-grep and Vale run concurrently and merge

- **WHEN** `.taskless/sg/` and `.taskless/vale/` both contain rules
- **THEN** the CLI runs both engines concurrently and returns one merged result set whose findings count toward the exit code identically

#### Scenario: One engine unavailable, others proceed

- **WHEN** the `vale` binary is unavailable but `.taskless/sg/` has rules
- **THEN** the CLI reports the Vale engine as unavailable and still returns ast-grep results

### Requirement: Check restricts the run to named rules with --rule

The `check` subcommand SHALL accept a `--rule <id>` flag, repeatable, naming the rules the run is restricted to. When `--rule` is absent the run SHALL be unchanged. When one or more are given, the CLI SHALL report findings only for the named rules, and for each named rule SHALL report exactly what an unfiltered `check` over the same paths would have reported for it: the same walk, the same exclusions (`.taskless/`, `.git/`, git-ignored paths, converter-dependent formats), and the same per-rule scope.

A rule id is the name of a rule's directory under `.taskless/rules/<engine>/`. The filter SHALL apply to every engine. An id whose rule directory exists under more than one engine SHALL select the rule under each of them. An id that names no rule directory under any engine SHALL be refused: the CLI SHALL exit with code 1 and report the error code `RULE_NOT_FOUND` naming the unresolved id, and SHALL NOT run any engine.

`--rule` SHALL NOT widen what may run. A runtime rule named by `--rule` SHALL remain subject to the signature-validated path, and SHALL be reported as skipped on an unverified path exactly as it would be in an unfiltered run.

#### Scenario: A single --rule narrows the run to that rule

- **WHEN** a user runs `taskless check --rule <id>` in a project with rules beyond `<id>`
- **THEN** the results SHALL contain findings for `<id>` only
- **AND** they SHALL be the findings an unfiltered `taskless check` reports for `<id>`

#### Scenario: Repeated --rule unions the named rules

- **WHEN** a user runs `taskless check --rule a --rule b`
- **THEN** the results SHALL contain the findings for `a` and the findings for `b`, and no others

#### Scenario: The filter applies to both static engines

- **WHEN** a user names an ast-grep rule with `--rule`, and separately names a Vale rule
- **THEN** each run SHALL report that rule's findings over the whole project
- **AND** a Vale rule SHALL be measured under its own config's matchers, not over every file Vale can read

#### Scenario: Whole-project exclusions still apply under --rule

- **WHEN** a user runs `taskless check --rule <id>` with no positional paths in a project with git-ignored directories
- **THEN** the CLI SHALL NOT report findings from `.taskless/`, `.git/`, or git-ignored paths

#### Scenario: A refused sibling config refuses a filtered run too

- **WHEN** a user runs `taskless check --rule <id>` in a project where a DIFFERENT Vale rule's config is rejected by the config schema
- **THEN** the CLI SHALL refuse the Vale engine and exit non-zero, exactly as an unfiltered `taskless check` does
- **AND** the refusal SHALL name the rejected rule even though `--rule` did not select it

#### Scenario: An unknown rule id is refused

- **WHEN** a user runs `taskless check --rule <id>` and no engine directory holds a rule directory named `<id>`
- **THEN** the CLI SHALL exit with code 1
- **AND** under `--json` stdout SHALL carry the standardized error envelope with code `RULE_NOT_FOUND` and a message naming `<id>`
- **AND** the CLI SHALL NOT run any engine

#### Scenario: An id held by two engines selects both rules

- **WHEN** a user runs `taskless check --rule <id>` and `<id>` names a rule directory under two engines
- **THEN** the CLI SHALL run both rules and SHALL report the findings of each, distinguished by the `source` field

#### Scenario: --rule does not bypass the runtime signature gate

- **WHEN** a user runs `taskless check --rule <id>` where `<id>` is a runtime rule and the run is on an unverified path
- **THEN** the CLI SHALL NOT execute that rule's `check.ts`
- **AND** SHALL report it as skipped exactly as an unfiltered `check` would

#### Scenario: --rule leaves positional path arguments intact

- **WHEN** a user runs `taskless check --rule <id> src/foo.ts`
- **THEN** the CLI SHALL treat `src/foo.ts` as the path to scan and `<id>` as the rule filter
- **AND** SHALL NOT treat `<id>` as a path

### Requirement: Notices render one marker per notice and publish as a flat list

`check` SHALL carry advisory messages as an ordered list in which one element is one notice, and SHALL NOT join several notices into one element.

In human output the CLI SHALL prefix EVERY line it prints of a notice with the `Notice: ` marker, including the second and later lines of a notice that spans lines. A notice may legitimately span lines — an engine's own diagnostic output is passed through as written — so a marker on the first line alone leaves the rest reading as unlabelled stray output, which is the failure this requires against.

Every notice the run reports SHALL be marked alike, whichever stage produced it — runtime planning or engine dispatch. `--json` merges both into one `notices` array, so text output that marked one source and not the other made the same message look like two different kinds of thing depending on which list it arrived on.

Under `--json` the `notices` array SHALL be flat: each element SHALL be exactly one notice. A consumer SHALL NOT be required to split an element on a separator, because no separator between notices is published and none is part of the contract.

A notice SHALL NOT affect the exit code.

#### Scenario: Two independent advisories each get their own marker

- **WHEN** a `check` run produces two independent notices and human output is rendered
- **THEN** each notice SHALL be printed on its own line behind its own `Notice: ` marker

#### Scenario: Every line of a multi-line notice is marked

- **WHEN** a single notice spans several lines and human output is rendered
- **THEN** the CLI SHALL print each of its lines behind a `Notice: ` marker

#### Scenario: A runtime plan notice is marked like an engine notice

- **WHEN** runtime planning reports a notice and human output is rendered
- **THEN** the CLI SHALL print it behind the same `Notice: ` marker it gives an engine's notice

#### Scenario: A machine consumer receives one notice per element

- **WHEN** a `check --json` run produces two independent notices
- **THEN** the `notices` array SHALL hold two elements, one notice each

#### Scenario: Nothing to say publishes nothing

- **WHEN** a `check` run produces no notices
- **THEN** human output SHALL print no `Notice: ` line
- **AND** `--json` SHALL omit the `notices` field

### Requirement: Check reports runtime rules withheld for entitlement as a plan outcome

When reconciliation completes and returns a non-empty `entitlement.withheld`, `taskless check` SHALL NOT execute any withheld rule, SHALL report each local runtime rule whose `ruleId` appears in `withheld` as skipped with a reason stating that runtime rules are not included in the organization's plan, and SHALL NOT describe it as unsafe, unknown, drifted, or tampered. The human output SHALL include one notice naming the withheld rules, the `entitlement.reason`, and the `entitlement.upgradeUrl` when present. Under `--json`, the output SHALL carry an additive, optional `entitlement` object with `runtimeSignatures`, `reason`, `upgradeUrl`, and `withheld` (the local rule names), present only when reconciliation returned `runtimeSignatures: false`. This is a verified outcome and SHALL NOT be treated as one of the unverified paths that leave the exit code unchanged.

#### Scenario: Withheld rule is named with its cause

- **WHEN** an authenticated `check` reconciles and `entitlement.withheld` lists runtime rule `no-env-leak-3fa9c21b`
- **THEN** `no-env-leak-3fa9c21b` SHALL NOT execute
- **AND** its skip reason SHALL state that runtime rules are not included in the plan
- **AND** its skip reason SHALL NOT mention unsafe, unknown, or drift

#### Scenario: Upgrade URL is shown once

- **WHEN** two runtime rules are withheld and `entitlement.upgradeUrl` is present
- **THEN** the human output SHALL print the upgrade URL exactly once, in one notice naming both rules and the reason

#### Scenario: Entitlement appears under --json

- **WHEN** a runtime rule is withheld and `--json` is set
- **THEN** stdout SHALL include `entitlement` with `runtimeSignatures: false`, `reason`, `upgradeUrl`, and `withheld` naming the rule
- **AND** `skipped` SHALL still list the rule with its plan reason

#### Scenario: A server without the entitlement object is unchanged

- **WHEN** reconciliation returns `entitlement: { runtimeSignatures: true }`, or (against its schema) no `entitlement` object at all
- **THEN** `check --json` SHALL omit the `entitlement` field
- **AND** no rule SHALL be skipped for its plan

#### Scenario: Degrade paths still never fail

- **WHEN** `check` runs logged out, with `--anonymous`, or reconciliation cannot complete
- **THEN** the exit code SHALL NOT change because runtime rules were skipped, as before this change

### Requirement: Check never writes to the rules tree

`taskless check` SHALL NOT create, modify, or delete anything under `.taskless/rules/`. It
SHALL NOT call restore, rollback, or rule fetch. For an `unsafe` or `missing` verdict it SHALL
name the command that repairs the rule, `taskless rule restore <ruleId>`. The only files
`check` writes under `.taskless/` SHALL be under `.taskless/.run/`.

#### Scenario: An edited rule is reported, not repaired

- **WHEN** reconciliation returns `unsafe` for a rule
- **THEN** `.taskless/rules/` SHALL be byte-identical before and after the run
- **AND** the output SHALL name `taskless rule restore <ruleId>`

#### Scenario: A missing rule is not fetched

- **WHEN** reconciliation returns `missing` for a rule
- **THEN** `check` SHALL NOT call any restore or fetch endpoint
- **AND** SHALL NOT create the rule's directory

### Requirement: Each check run works in its own run directory

`taskless check` SHALL do its work (the snapshot, the assembled engine configs, and its logs)
in a directory of its own, `.taskless/.run/<runId>/`, where `<runId>` is unique per run and
sorts by start time. Two runs SHALL never share a run directory. The directory SHALL hold an
`owner` record naming the process and host using it, and the logs `engine.log` (the plan: what
was copied, reported, judged, excluded, and run), `sg.log` and `vale.log` (each engine's
command line, output, and exit code), and `runtime.log` (each runtime rule's duration,
findings, and any error). No log SHALL contain a credential. The CLI SHALL remove the run
directory when the run ends, whether it succeeded or failed, and on SIGINT or SIGTERM, unless
`--preserve-logs` is set. `.taskless/.run/` SHALL ignore itself with its own `.gitignore`, so
that no run rewrites a tracked file. `rule restore` SHALL take its snapshot the same way.

#### Scenario: Concurrent runs do not disturb each other

- **WHEN** several `taskless check` runs execute at the same time in one project
- **THEN** each SHALL report the same findings it reports alone
- **AND** none SHALL read another's snapshot

#### Scenario: Nothing is left behind

- **WHEN** a `taskless check` run ends, successfully or not, without `--preserve-logs`
- **THEN** its run directory SHALL no longer exist

### Requirement: Check accepts --preserve-logs to keep its run directory

`taskless check` SHALL accept `--preserve-logs` (alias `-l`), which keeps the run directory
instead of removing it: the snapshot that ran, the assembled configs, the `owner` record, and
the logs. Human output SHALL name the kept directory on stderr. Under `--json`, the output
SHALL carry an additive, optional `runDirectory` field, the directory's path relative to the
project root, present only when the flag is set. A kept directory SHALL hold a `preserve` marker
beside its `owner` record, and SHALL survive later runs while the marker is there, until it is
swept for age (see "Abandoned run directories are swept"). Deleting the marker SHALL release the
directory to the next run's sweep.

#### Scenario: A preserved run is named and complete

- **WHEN** a user runs `taskless check --json --preserve-logs`
- **THEN** stdout SHALL include `runDirectory`
- **AND** that directory SHALL hold `engine.log`, `sg.log`, `vale.log`, `runtime.log`, `owner`, `preserve`, and the snapshot

#### Scenario: A preserved run survives the next run

- **WHEN** a `taskless check --preserve-logs` run has ended and another `taskless check` starts
- **THEN** the kept run directory SHALL still exist

#### Scenario: Deleting the marker releases a kept directory

- **WHEN** the `preserve` marker is deleted from a kept run directory whose run has ended
- **THEN** the next run SHALL remove the directory

#### Scenario: A preserved authenticated run holds no credential

- **WHEN** an authenticated `check --preserve-logs` reconciles
- **THEN** no file in the kept run directory SHALL contain the token

### Requirement: Abandoned run directories are swept

At the start of every run, the CLI SHALL remove each directory under `.taskless/.run/` whose
`owner` names a process on this host that is no longer alive, and each directory with no
`owner` record (left by an earlier version). It SHALL NOT remove a directory whose owning
process is alive, one owned by another host, since this host cannot tell whether that process
lives, or one holding a `preserve` marker. Liveness SHALL be the test, not age, with one backstop:
a directory whose run started more than 24 hours ago SHALL be removed whatever its owner. That
covers a dead run's process id recycled by an unrelated process, a host that never returns, and
a kept directory nobody went back to.

#### Scenario: A killed run's directory is swept

- **WHEN** a run directory's `owner` names a process on this host that has exited
- **THEN** the next run SHALL remove it

#### Scenario: A live run is never swept

- **WHEN** a run directory's owning process is still running, or it is owned by another host
- **AND** its run started less than 24 hours ago
- **THEN** no other run SHALL remove it

#### Scenario: A day-old directory is swept whatever its owner

- **WHEN** a run directory's run started more than 24 hours ago
- **THEN** the next run SHALL remove it, even if its process id names a live process, it is owned by another host, or it was kept by `--preserve-logs`

### Requirement: Check reports rule integrity under --json

Under `--json`, `taskless check` SHALL carry an additive, optional `integrity` array with one
entry per rule whose outcome is `unsafe`, `missing`, runtime `unknown`, `unaccounted`, or
`duplicate`, each `{ ruleId, engine?, verdict, files?, revisionId? }`. `files` SHALL list each
differing path with `expected` and `got` as the server returned them. Static `unknown` rules
and `run` rules SHALL NOT appear. The field SHALL be omitted when there is nothing to report.

#### Scenario: An edited rule appears with its differing files

- **WHEN** reconciliation returns `unsafe` for vale rule `no-simply-1a2b3c4d` with `.vale.ini` changed
- **THEN** `integrity` SHALL include `{ ruleId: "no-simply-1a2b3c4d", engine: "vale", verdict: "unsafe", files: [{ path: ".vale.ini", expected, got }] }`

#### Scenario: A clean run omits the field

- **WHEN** every reported rule is `run` or static `unknown` and nothing is `missing`
- **THEN** `check --json` SHALL NOT include `integrity`
