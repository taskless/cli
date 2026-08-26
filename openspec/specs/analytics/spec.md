# Analytics

## Purpose

Defines the PostHog telemetry module for the `@taskless/cli` package — anonymous identity, authenticated identity upgrade, opt-out, event capture, and client lifecycle.

## Requirements

### Requirement: Telemetry module exports getTelemetry

The CLI SHALL provide a `getTelemetry(cwd?: string)` function in `src/telemetry.ts` that returns a telemetry object with `capture(event: string, properties?: Record<string, unknown>)` and `shutdown()` methods. The function SHALL resolve identity, create the PostHog client, and call `identify()` internally before returning. The `identify()` call is not exposed on the public interface.

#### Scenario: Telemetry object is created

- **WHEN** `getTelemetry()` is called
- **THEN** it SHALL return an object with `capture` and `shutdown` methods

#### Scenario: Telemetry resolves identity on creation

- **WHEN** `getTelemetry(cwd)` is called with a working directory that has a valid JWT
- **THEN** it SHALL resolve the authenticated identity (JWT subject as `distinctId`, org group) before returning

### Requirement: Anonymous identity persists in XDG config

The CLI SHALL generate a UUID v4 on first run and persist it to `$XDG_CONFIG_HOME/taskless/anonymous_id` (or `~/.config/taskless/anonymous_id`). Subsequent invocations SHALL read the existing UUID. The file SHALL contain only the raw UUID string (no JSON, no newline).

#### Scenario: First run generates anonymous ID

- **WHEN** `getTelemetry()` is called and `anonymous_id` does not exist
- **THEN** the CLI SHALL generate a UUID v4, write it to the XDG config directory, and use it as the `distinctId`

#### Scenario: Subsequent run reads existing anonymous ID

- **WHEN** `getTelemetry()` is called and `anonymous_id` already exists
- **THEN** the CLI SHALL read the existing UUID and use it

#### Scenario: Anonymous ID file is deleted

- **WHEN** the `anonymous_id` file is manually deleted between invocations
- **THEN** the CLI SHALL generate a new UUID on the next run

#### Scenario: XDG config directory does not exist

- **WHEN** the XDG config directory (`~/.config/taskless/`) does not exist
- **THEN** the CLI SHALL create it before writing the `anonymous_id` file

### Requirement: Authenticated identity upgrade

When a valid JWT is available (via `getToken()`), the CLI SHALL use the JWT subject (`sub` claim) as the `distinctId` instead of the anonymous UUID. It SHALL call `posthog.identify()` with the `cli` property set to the anonymous UUID, linking the device to the authenticated user. It SHALL call `posthog.groupIdentify()` with the `organization` group type and the JWT `orgId` claim as the group key.

#### Scenario: JWT available upgrades identity

- **WHEN** `getTelemetry(cwd)` is called and a valid JWT exists for the working directory
- **THEN** `distinctId` SHALL be the JWT `sub` claim
- **AND** `identify()` SHALL be called with `{ cli: anonymousUuid }`
- **AND** `groupIdentify()` SHALL be called with `{ groupType: 'organization', groupKey: String(orgId) }`

#### Scenario: No JWT falls back to anonymous

- **WHEN** `getTelemetry(cwd)` is called and no JWT is available
- **THEN** `distinctId` SHALL be the anonymous UUID
- **AND** `identify()` SHALL be called with `{ cli: anonymousUuid }`
- **AND** `groupIdentify()` SHALL NOT be called

### Requirement: Telemetry is disabled by environment variable

Setting `TASKLESS_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1` SHALL cause `getTelemetry()` to return an inert stub with no-op implementations of `capture` and `shutdown`. No PostHog client SHALL be created. No network requests SHALL be made. No anonymous ID file SHALL be read or written.

#### Scenario: TASKLESS_TELEMETRY_DISABLED disables telemetry

- **WHEN** `TASKLESS_TELEMETRY_DISABLED` is set to `"1"`
- **THEN** `getTelemetry()` SHALL return a no-op stub
- **AND** no PostHog client SHALL be instantiated

#### Scenario: DO_NOT_TRACK disables telemetry

- **WHEN** `DO_NOT_TRACK` is set to `"1"`
- **THEN** `getTelemetry()` SHALL return a no-op stub

#### Scenario: Telemetry enabled by default

- **WHEN** neither `TASKLESS_TELEMETRY_DISABLED` nor `DO_NOT_TRACK` is set
- **THEN** `getTelemetry()` SHALL create a real PostHog client

### Requirement: PostHog client uses hardcoded constants

The PostHog client SHALL be created with project token `phc_stymptTiUskp4zM3m9StNSGheHwjskaYagpxV7rDjZyc` and host `https://z.taskless.io`. These SHALL be hardcoded constants in the telemetry module, not read from environment variables or config files.

#### Scenario: Client uses correct project token and host

- **WHEN** a PostHog client is created
- **THEN** it SHALL use the hardcoded project token and host URL

### Requirement: PostHog client uses immediate flush

The PostHog client SHALL be created with `flushAt: 1` and `flushInterval: 0` because the CLI is a short-lived process. `shutdown()` SHALL be called before the process exits to ensure buffered events are delivered.

#### Scenario: Events flush immediately

- **WHEN** `capture()` is called
- **THEN** the event SHALL be flushed immediately (not batched)

#### Scenario: Shutdown flushes remaining events

- **WHEN** `shutdown()` is called
- **THEN** all buffered events SHALL be flushed before the promise resolves

### Requirement: PostHog property names are snake_case

Every property name attached to a PostHog `identify()` or `capture()` call SHALL
be `snake_case`. This is the naming convention of the PostHog ecosystem, whose
own properties (`$current_url`, `$lib_version`) are spelled that way, and mixing
conventions makes a property list unsearchable by anyone building an insight.

JSON payloads the CLI emits to stdout (for example `taskless info --json`) are a
separate wire format with a separate audience, and SHALL remain `camelCase` per
the CLI spec. The same value MAY therefore appear as `loggedIn` in JSON and
`logged_in` in telemetry; that is each format following its own ecosystem's
convention, not a discrepancy to reconcile.

A single-word property name (`cli`, `anonymous`, `command`, `success`) satisfies
this requirement unchanged. Parameters of the PostHog SDK itself, such as
`groupIdentify`'s `groupType` and `groupKey`, are not properties the CLI names
and are out of scope.

#### Scenario: A multi-word telemetry property is snake_case

- **WHEN** a `capture()` call carries a property whose name has more than one word
- **THEN** the property name SHALL be spelled `snake_case` (for example
  `cli_version`, `scaffold_version`, `duration_ms`, `logged_in`, `rule_count`)

#### Scenario: The JSON field and the telemetry property may differ in spelling

- **WHEN** the same value is reported both in `taskless info --json` and as a
  telemetry property
- **THEN** the JSON field SHALL be `camelCase` (`loggedIn`) and the telemetry
  property SHALL be `snake_case` (`logged_in`)

### Requirement: All capture calls include standard properties

Every `capture()` call SHALL include the `cli` property (anonymous UUID), the `cli_version` property (the version the build reports as its own, baked in at build time), and the `scaffold_version` property (the `version` field from `.taskless/taskless.json`, or `0` if the manifest is absent or unreadable). When authenticated, the `groups` parameter SHALL include `{ organization: String(orgId) }`. The `cli_version` and `scaffold_version` values SHALL be resolved once at telemetry initialization and attached to every subsequent `capture()` call without re-reading the source files.

#### Scenario: Anonymous capture includes standard properties

- **WHEN** `capture("cli_run")` is called without authentication
- **THEN** the event SHALL include `{ cli: anonymousUuid, cli_version: <string>, scaffold_version: <number> }`
- **AND** the event SHALL NOT include a `groups` parameter

#### Scenario: Authenticated capture includes standard properties and group

- **WHEN** `capture("cli_rule_created")` is called with authentication
- **THEN** the event SHALL include `{ cli: anonymousUuid, cli_version: <string>, scaffold_version: <number> }`
- **AND** the `groups` parameter SHALL include `{ organization: String(orgId) }`

#### Scenario: Scaffold version falls back to 0 when manifest missing

- **WHEN** `getTelemetry(cwd)` is initialized in a directory with no `.taskless/taskless.json`
- **THEN** every `capture()` call from the returned client SHALL include `scaffold_version: 0`

#### Scenario: CLI version is the version the build reports as its own

- **WHEN** `getTelemetry()` is initialized
- **THEN** `cli_version` SHALL be the version the build reports as its own, bundled at build time
- **AND** for every build target but `nightly` that SHALL be the version in `packages/cli/package.json`
- **AND** for a `nightly` it SHALL be the version the nightly is published under, so events are attributed to the build that emitted them rather than to the release it anticipates
- **AND** SHALL be attached to every event emitted through the returned client

### Requirement: CLI events use cli\_ prefix

CLI events SHALL use the `cli_` prefix, with the taxonomy organized as a
`cli_run` denominator plus concrete state-transition events:

- `cli_run` — exactly one per invocation (see the dedicated requirement). This
  replaces every previous `cli_<action>` start event and `cli_<action>_completed`
  event; the `success`/`duration_ms`/`command` signal lives here.
- Concrete state-transition events, each fired at the point the state actually
  changes, carrying counts/ids/booleans only (never rule content, prompts, or
  matched source):
  - `cli_rule_created`, `cli_rule_improved`, `cli_rule_deleted`
  - `cli_authenticated`, `cli_logged_out`
  - `cli_installed`, `cli_onboarded`
  - `cli_check_completed` — error/warning counts only (e.g. `errorCount`,
    `warningCount`, `findings`)
  - `cli_error` — a single failure event with `command` and `code` (a stable
    `CLIErrorCode`)
- `cli_agent` — fired when the `agent` command serves a request, with a `topic`
  property (the served topic; the exact literal `"(index)"` when invoked with no
  topic; the attempted topic for an unknown request). This replaces the previous
  `help_index`, `help_<topic>`, and `help_unknown` events.

Commands that carry no concrete state beyond the invocation (e.g. `info`,
`detect`, `update`, `auth status`, `rule verify`, `rule meta`) SHALL rely on
`cli_run` alone and SHALL NOT emit a bespoke event. The previous taxonomy
(`cli_<action>`, `cli_<action>_completed`, `help_index`, `help_<topic>`,
`help_unknown`) SHALL be removed in this release; there is no dual-emit window.

#### Scenario: Rule creation emits a concrete state event plus cli_run

- **WHEN** a user runs `taskless rule create --from req.json` and a rule is written
- **THEN** PostHog SHALL receive one `cli_run` event with `command: "rule create"`
- **AND** SHALL receive a `cli_rule_created` event
- **AND** SHALL NOT receive `cli_rule_create` or `cli_rule_create_completed`

#### Scenario: Recipe fetch emits cli_agent with a topic

- **WHEN** an agent runs `taskless agent create-sg-rule`
- **THEN** PostHog SHALL receive a `cli_agent` event with `topic: "create-sg-rule"`
- **AND** SHALL NOT receive a `help_create_sg_rule` event

#### Scenario: Fetch with no topic emits cli_agent with the index marker

- **WHEN** an agent runs `taskless agent`
- **THEN** PostHog SHALL receive a `cli_agent` event with `topic: "(index)"`
- **AND** SHALL NOT receive a `help_index` event

#### Scenario: A command failure emits cli_error

- **WHEN** a command fails with a known `CLIErrorCode`
- **THEN** PostHog SHALL receive a `cli_error` event with `command` and `code`

#### Scenario: Old event names are not emitted

- **WHEN** any CLI command runs in this release
- **THEN** PostHog SHALL NOT receive any event named `cli_<action>_completed`,
  `help_index`, `help_<topic>`, or `help_unknown`

### Requirement: Wrong-topic re-routing is observable as a derivable funnel

The taxonomy SHALL keep wrong-topic re-routing derivable as a funnel signal from
the new events:

- A `cli_agent { topic: A }` event not followed by the concrete event for topic A
  (or by `cli_run` with the corresponding `command`), and then a subsequent
  `cli_agent { topic: B }`, indicates the agent fetched recipe A, did not act on
  it, and re-routed to topic B.
- A `cli_agent` index-marker event followed by a `cli_agent { topic }` event
  indicates the agent consulted the index before picking a topic (baseline).
- A `cli_agent { topic }` event with no subsequent acting `cli_run` and no further
  `cli_agent` event indicates the agent abandoned the action.

No additional events SHALL be added to capture this signal directly — it is
derivable from the `cli_agent` / `cli_run` sequence. Dashboards SHOULD surface
re-routing rates per topic.

#### Scenario: Funnel data supports wrong-topic detection

- **WHEN** dashboards are constructed in PostHog
- **THEN** the `cli_agent` (with `topic`) and `cli_run` (with `command`) events
  SHALL be sufficient to compute "rate of `cli_agent { topic }` not followed by a
  corresponding acting `cli_run` within N minutes"

### Requirement: Telemetry failures are silent

All telemetry operations (client creation, `capture`, `identify`, `groupIdentify`, `shutdown`) SHALL catch and suppress errors. A telemetry failure SHALL NOT cause a command to fail or alter its exit code.

#### Scenario: Network failure during capture

- **WHEN** the PostHog API is unreachable during `capture()`
- **THEN** the error SHALL be silently suppressed
- **AND** the command SHALL continue normally

#### Scenario: Malformed anonymous ID file

- **WHEN** the `anonymous_id` file exists but contains invalid content
- **THEN** the CLI SHALL generate a new UUID and overwrite the file

### Requirement: Telemetry lifecycle uses lazy init with centralized shutdown

Each command handler SHALL call `getTelemetry(cwd)` to lazily initialize the singleton with the correct working directory for identity resolution. The main entry point (`src/index.ts`) SHALL call `shutdownTelemetry()` in a `finally` block after the subcommand completes. If no command initialized telemetry, shutdown SHALL be a no-op (no PostHog client created).

#### Scenario: Telemetry is initialized lazily by command handler

- **WHEN** a subcommand handler runs
- **THEN** it SHALL call `getTelemetry(cwd)` to initialize telemetry with the resolved working directory

#### Scenario: Telemetry is shut down after subcommand completes

- **WHEN** a subcommand handler returns
- **THEN** `shutdownTelemetry()` SHALL be called in the entry point `finally` block before the process exits

#### Scenario: No telemetry init when no command runs

- **WHEN** the CLI exits without running a command (e.g. showing top-level help)
- **THEN** `shutdownTelemetry()` SHALL be a no-op and no PostHog client SHALL be created

### Requirement: Every invocation emits exactly one cli_run event

The CLI SHALL emit exactly one `cli_run` event per invocation, from the top-level
runner rather than from individual commands. The event SHALL carry the properties
`command` (the resolved subcommand name, e.g. `"rule create"` or `"help"`),
`cli_version`, `success` (boolean), `duration_ms` (number), `anonymous` (boolean),
and `logged_in` (boolean). The event SHALL be emitted on both success and failure
(from a `finally`-equivalent path), and no command SHALL emit its own
"started" or "ran" event.

#### Scenario: A successful command emits one cli_run

- **WHEN** a user runs `taskless info`
- **THEN** PostHog SHALL receive exactly one `cli_run` event with
  `command: "info"`, `success: true`, a numeric `duration_ms`, and the
  `cli_version`, `anonymous`, and `logged_in` properties
- **AND** SHALL NOT receive a separate `cli_info` or `cli_info_completed` event

#### Scenario: A failing command still emits cli_run

- **WHEN** a command exits with an error
- **THEN** PostHog SHALL receive one `cli_run` event with `success: false`

### Requirement: Identify carries the GitHub owner

Telemetry SHALL include a `gh_owner` property on every identify and on captured events, on authenticated and anonymous runs alike.

When a GitHub owner can be extracted from the project's git remote, `gh_owner` SHALL be that owner segment verbatim. When it cannot, for ANY reason, `gh_owner` SHALL be the literal sentinel `[unknown]` rather than being omitted, so runs with an unresolvable owner are a countable cohort instead of disappearing from aggregates. The sentinel cannot collide with a real value: GitHub owner names are limited to alphanumeric characters and hyphens, so no owner can be spelled `[unknown]`.

"Any reason" includes the case where **git is not installed or not on `PATH`**. That is not one of the three no-remote populations, and it is not an error: the resolution simply cannot run. It resolves to `[unknown]` like every other unresolvable case, and SHALL NOT fail the command or surface a message.

The property SHALL be named `gh_owner` rather than `gh_org`, because the first path segment of a GitHub URL may be either an organization or a user account and the CLI does not determine which.

An unresolvable owner SHALL NOT affect the command: it is a telemetry value, not a precondition.

#### Scenario: Anonymous run in a GitHub repository

- **WHEN** an unauthenticated user runs any command in a repository whose `origin` is a GitHub URL
- **THEN** telemetry SHALL identify with `gh_owner` set to the owner segment of that remote

#### Scenario: Authenticated run in a GitHub repository

- **WHEN** an authenticated user runs any command in a repository whose `origin` is a GitHub URL
- **THEN** telemetry SHALL identify with `gh_owner` set to the owner segment of that remote

#### Scenario: No GitHub owner is resolvable

- **WHEN** a user runs any command in any of the three no-remote populations
- **THEN** telemetry SHALL identify with `gh_owner` set to `[unknown]`
- **AND** the property SHALL be present rather than omitted
- **AND** the command SHALL run to completion unaffected

#### Scenario: git is not installed

- **WHEN** a user runs any command on a host where `git` is not installed or not on `PATH`
- **THEN** telemetry SHALL identify with `gh_owner` set to `[unknown]`
- **AND** the command SHALL run to completion, with no error surfaced for the failed resolution

#### Scenario: The sentinel is distinguishable from a real owner

- **WHEN** `gh_owner` is read in analytics
- **THEN** the value `[unknown]` SHALL identify a run whose owner could not be parsed
- **AND** it SHALL NOT be producible by any valid GitHub owner name

#### Scenario: Owner type is not asserted

- **WHEN** `gh_owner` is recorded
- **THEN** the CLI SHALL NOT infer or record whether the owner is an organization or a user account
