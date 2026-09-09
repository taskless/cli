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

### Requirement: All capture calls include standard properties

Every `capture()` call SHALL include the `cli` property (anonymous UUID), the `cliVersion` property (the version the build reports as its own, baked in at build time), and the `scaffoldVersion` property (the `version` field from `.taskless/taskless.json`, or `0` if the manifest is absent or unreadable). It SHALL also include the adoption dimensions `workspaceId`, `repositoryId`, `envOS`, `ci`, `ciProvider`, and `languageStack`, each defined by its own requirement. When authenticated, the `groups` parameter SHALL include `{ organization: String(orgId) }`. The `cliVersion` and `scaffoldVersion` values SHALL be resolved once at telemetry initialization and attached to every subsequent `capture()` call without re-reading the source files, and the adoption dimensions SHALL be resolved once on the same terms.

Resolving the adoption dimensions SHALL NOT be a precondition for any command. Each one has a defined value for every failure of resolution, so a capture never has to choose between omitting a property and failing.

#### Scenario: Anonymous capture includes standard properties

- **WHEN** `capture("cli_run")` is called without authentication
- **THEN** the event SHALL include `{ cli: anonymousUuid, cliVersion: <string>, scaffoldVersion: <number> }`
- **AND** the event SHALL NOT include a `groups` parameter

#### Scenario: Authenticated capture includes standard properties and group

- **WHEN** `capture("cli_rule_created")` is called with authentication
- **THEN** the event SHALL include `{ cli: anonymousUuid, cliVersion: <string>, scaffoldVersion: <number> }`
- **AND** the `groups` parameter SHALL include `{ organization: String(orgId) }`

#### Scenario: Scaffold version falls back to 0 when manifest missing

- **WHEN** `getTelemetry(cwd)` is initialized in a directory with no `.taskless/taskless.json`
- **THEN** every `capture()` call from the returned client SHALL include `scaffoldVersion: 0`

#### Scenario: CLI version is the version the build reports as its own

- **WHEN** `getTelemetry()` is initialized
- **THEN** `cliVersion` SHALL be the version the build reports as its own, bundled at build time
- **AND** for every build target but `nightly` that SHALL be the version in `packages/cli/package.json`
- **AND** for a `nightly` it SHALL be the version the nightly is published under, so events are attributed to the build that emitted them rather than to the release it anticipates
- **AND** SHALL be attached to every event emitted through the returned client

#### Scenario: Every event carries the adoption dimensions

- **WHEN** any event is captured, authenticated or not
- **THEN** it SHALL include `workspaceId`, `repositoryId`, `envOS`, `ci`, `ciProvider`, and `languageStack`

#### Scenario: The dimensions are resolved once

- **WHEN** several events are captured within one invocation
- **THEN** each adoption dimension SHALL be resolved once at initialization
- **AND** SHALL NOT be re-read per event

### Requirement: CLI events use cli\_ prefix

CLI events SHALL use the `cli_` prefix, with the taxonomy organized as a
`cli_run` denominator plus concrete state-transition events:

- `cli_run` — exactly one per invocation (see the dedicated requirement). This
  replaces every previous `cli_<action>` start event and `cli_<action>_completed`
  event; the `success`/`durationMs`/`command` signal lives here.
- Concrete state-transition events, each fired at the point the state actually
  changes, carrying counts/ids/booleans only (never rule content, prompts, or
  matched source):
  - `cli_rule_created`, `cli_rule_improved`, `cli_rule_deleted`
  - `cli_authenticated`, `cli_logged_out`
  - `cli_installed`, `cli_onboarded`
  - `cli_check_completed` — error/warning counts and the number of rules the
    scan had loaded: `errorCount`, `warningCount`, `findings`, `ruleCount`.
    Counts only, never rule content, rule names, or matched source
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

#### Scenario: A completed scan reports how many rules were loaded

- **WHEN** a scan completes
- **THEN** the `cli_check_completed` event SHALL include `ruleCount`, the number
  of rules the scan had loaded
- **AND** a scan that loaded no rules SHALL be distinguishable from a scan that
  loaded rules and found nothing

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
`cli_version`, `success` (boolean), `durationMs` (number), `anonymous` (boolean),
and `loggedIn` (boolean). The event SHALL be emitted on both success and failure
(from a `finally`-equivalent path), and no command SHALL emit its own
"started" or "ran" event.

#### Scenario: A successful command emits one cli_run

- **WHEN** a user runs `taskless info`
- **THEN** PostHog SHALL receive exactly one `cli_run` event with
  `command: "info"`, `success: true`, a numeric `durationMs`, and the
  `cli_version`, `anonymous`, and `loggedIn` properties
- **AND** SHALL NOT receive a separate `cli_info` or `cli_info_completed` event

#### Scenario: A failing command still emits cli_run

- **WHEN** a command exits with an error
- **THEN** PostHog SHALL receive one `cli_run` event with `success: false`

### Requirement: Event names are snake_case and properties are camelCase

Telemetry SHALL name events in `snake_case` and properties in `camelCase`. The two are separate namespaces with separate conventions, and neither follows the other.

This is written down because it was already true and nobody could check it. Every event has been `snake_case` (`cli_run`, `cli_check_completed`) and every property `camelCase` (`cliVersion`, `durationMs`, `errorCount`) since telemetry was added, but with the rule unstated, a single misspelled property read as evidence about the majority rather than as the outlier it was, and a proposal to rename seven correct properties got as far as a reviewed pull request before the mistake was caught.

PostHog's own reserved properties are spelled `$current_url` and `$lib_version`. That is a fact about PostHog's namespace and SHALL NOT be read as guidance for this project's property names.

#### Scenario: A new event is added

- **WHEN** a new event is captured
- **THEN** its name SHALL be `snake_case` with the `cli_` prefix

#### Scenario: A new property is added

- **WHEN** a new property is attached to an event or to identify
- **THEN** its name SHALL be `camelCase`

#### Scenario: The conventions do not borrow from each other

- **WHEN** a property's name is chosen
- **THEN** the `snake_case` spelling of surrounding event names SHALL NOT be taken as a reason to spell the property in `snake_case`

### Requirement: Identify carries the GitHub owner

Telemetry SHALL include a `ghOwner` property on every identify and on captured events, on authenticated and anonymous runs alike.

When a GitHub owner can be extracted from the project's git remote, `ghOwner` SHALL be that owner segment verbatim. When it cannot, for ANY reason, `ghOwner` SHALL be the literal sentinel `[unknown]` rather than being omitted, so runs with an unresolvable owner are a countable cohort instead of disappearing from aggregates. The sentinel cannot collide with a real value: GitHub owner names are limited to alphanumeric characters and hyphens, so no owner can be spelled `[unknown]`.

"Any reason" includes the case where **git is not installed or not on `PATH`**. That is not one of the three no-remote populations, and it is not an error: the resolution simply cannot run. It resolves to `[unknown]` like every other unresolvable case, and SHALL NOT fail the command or surface a message.

The property SHALL be named `ghOwner` rather than `gh_org`, because the first path segment of a GitHub URL may be either an organization or a user account and the CLI does not determine which.

An unresolvable owner SHALL NOT affect the command: it is a telemetry value, not a precondition.

#### Scenario: Anonymous run in a GitHub repository

- **WHEN** an unauthenticated user runs any command in a repository whose `origin` is a GitHub URL
- **THEN** telemetry SHALL identify with `ghOwner` set to the owner segment of that remote

#### Scenario: Authenticated run in a GitHub repository

- **WHEN** an authenticated user runs any command in a repository whose `origin` is a GitHub URL
- **THEN** telemetry SHALL identify with `ghOwner` set to the owner segment of that remote

#### Scenario: No GitHub owner is resolvable

- **WHEN** a user runs any command in any of the three no-remote populations
- **THEN** telemetry SHALL identify with `ghOwner` set to `[unknown]`
- **AND** the property SHALL be present rather than omitted
- **AND** the command SHALL run to completion unaffected

#### Scenario: git is not installed

- **WHEN** a user runs any command on a host where `git` is not installed or not on `PATH`
- **THEN** telemetry SHALL identify with `ghOwner` set to `[unknown]`
- **AND** the command SHALL run to completion, with no error surfaced for the failed resolution

#### Scenario: The sentinel is distinguishable from a real owner

- **WHEN** `ghOwner` is read in analytics
- **THEN** the value `[unknown]` SHALL identify a run whose owner could not be parsed
- **AND** it SHALL NOT be producible by any valid GitHub owner name

#### Scenario: Owner type is not asserted

- **WHEN** `ghOwner` is recorded
- **THEN** the CLI SHALL NOT infer or record whether the owner is an organization or a user account

### Requirement: Workspace and repository identity

Telemetry SHALL attach a `workspaceId` and a `repositoryId` property to every
identify and every captured event.

`workspaceId` SHALL be the SHA-256 hash, hex-encoded, of the absolute path of
the workspace root. The workspace root SHALL be the git top-level directory when
the working directory sits inside a git working tree, and the resolved working
directory otherwise. Resolving upward to the top-level is what makes the value a
workspace identifier rather than a directory identifier: an invocation from a
subdirectory SHALL report the same `workspaceId` as one from the root.

`repositoryId` SHALL be the SHA-256 hash, hex-encoded, of a canonical
`{host}/{owner}/…/{repo}` string derived from the `origin` remote — the
WHOLE remote path, so two repositories sharing an owner and a leaf name under
different nested groups stay distinct — lowercased,
with any `.git` suffix and trailing slash removed and any userinfo, port, query,
and fragment discarded. It SHALL NOT be restricted to GitHub remotes: a GitLab,
Bitbucket, or self-hosted repository SHALL receive a `repositoryId` on the same
terms. Where no `origin` remote resolves — for any reason, including a directory
that is not a repository and a host where `git` is unavailable — `repositoryId`
SHALL be the literal sentinel `[unknown]`, present rather than omitted, so those
runs stay countable.

Neither hash SHALL be described or relied upon as a secret. `repositoryId` is a
stable pseudonym: a hash of a remote URL is reversible by anyone who can
enumerate candidate URLs. It is hashed because a repository NAME can be an
unannounced product, which is a different question from whether the value is
confidential. `workspaceId` hashes a local absolute path, which commonly contains
a username and is not enumerable, so hashing there is protective in a way that
hashing `repositoryId` is not.

`ghOwner` SHALL remain unhashed. A GitHub owner is public identity, and the
value is load-bearing precisely because it is legible: excluding a known owner
from external-adoption counts, and judging a cohort for plausibility, both
require the name. The boundary is therefore owner legible, repository not.

Resolution SHALL NOT fail a command. Every unresolvable case SHALL produce a
value, never an exception.

#### Scenario: Invocation from a subdirectory reports the workspace root

- **WHEN** a command runs in a subdirectory of a git working tree
- **THEN** `workspaceId` SHALL be the hash of the git top-level path
- **AND** SHALL equal the `workspaceId` reported by the same command run at the root

#### Scenario: Working directory is not a git working tree

- **WHEN** a command runs outside any git working tree
- **THEN** `workspaceId` SHALL be the hash of the resolved working directory

#### Scenario: Non-GitHub remote still yields a repository identity

- **WHEN** a command runs in a repository whose `origin` is hosted somewhere
  other than GitHub
- **THEN** `repositoryId` SHALL be a hash of that repository's canonical
  `{host}/{owner}/…/{repo}`
- **AND** `ghOwner` SHALL be `[unknown]`, since the GitHub-owner question has no
  answer for that remote

#### Scenario: No origin remote

- **WHEN** a command runs in a directory with no resolvable `origin` remote
- **THEN** `repositoryId` SHALL be `[unknown]`
- **AND** the property SHALL be present rather than omitted

#### Scenario: The same repository cloned twice

- **WHEN** the same repository is cloned to two paths on one machine
- **THEN** the two clones SHALL report the same `repositoryId`
- **AND** SHALL report different `workspaceId` values

#### Scenario: The GitHub owner is not hashed

- **WHEN** `ghOwner` and `repositoryId` are recorded for the same GitHub repository
- **THEN** `ghOwner` SHALL be the owner segment verbatim
- **AND** `repositoryId` SHALL be a hash

### Requirement: Execution environment dimensions

Telemetry SHALL attach `envOS`, `ci`, and `ciProvider` properties to every
identify and every captured event.

`envOS` SHALL be the value of `process.platform`.

`ci` SHALL be a boolean, true when the `CI` environment variable is set to a
positive value. Unset, empty, `"0"`, and `"false"` SHALL each be treated as
false; any other non-empty value SHALL be treated as true.

`ciProvider` SHALL name the detected continuous-integration provider. When `ci`
is true and no provider is recognized, it SHALL be the literal sentinel
`[unknown]`. When `ci` is false, it SHALL be the literal sentinel `[none]`. Both
SHALL be present rather than omitted, so unrecognized and non-CI runs remain
countable and remain distinguishable from each other.

These dimensions exist because the anonymous identity cannot separate automated
runs from human ones. `$XDG_CONFIG_HOME/taskless/anonymous_id` is regenerated in
a fresh container, so without `ci` every CI job is indistinguishable from a new
install, and no property stored on past events can repair that after the fact.

#### Scenario: Local run

- **WHEN** a command runs with `CI` unset
- **THEN** `ci` SHALL be false
- **AND** `ciProvider` SHALL be `[none]`

#### Scenario: CI run on a recognized provider

- **WHEN** a command runs under a recognized CI provider
- **THEN** `ci` SHALL be true
- **AND** `ciProvider` SHALL name that provider

#### Scenario: CI run on an unrecognized provider

- **WHEN** a command runs with `CI` set to a positive value and no known
  provider environment variable present
- **THEN** `ci` SHALL be true
- **AND** `ciProvider` SHALL be `[unknown]`

#### Scenario: CI is set to a negative value

- **WHEN** a command runs with `CI` set to `"0"`, `"false"`, or the empty string
- **THEN** `ci` SHALL be false

### Requirement: Language stack dimension

Telemetry SHALL attach a `languageStack` property to every identify and every
captured event, listing the languages evidenced by manifest files present at the
workspace root.

The property exists to prioritize the rule corpus against the stacks that
actually run it, so its value is a coarse dimension rather than a detection
result.

It SHALL be resolved from a bounded, root-only probe and SHALL NOT invoke
`detectRepository`. The detection scan performs a recursive walk with manifest
parsing, which is acceptable for a command the user asked for and is not
acceptable on every invocation, including the `agent` fetches an agent makes
repeatedly.

The probe SHALL read its language-to-manifest mapping from the same
`LANGUAGE_MARKERS` constant the detection scan uses, extended with the Node
manifest that the scan derives JavaScript and TypeScript from. The two SHALL
differ only in search scope. This is stated so a future reader does not
reconcile them by making the telemetry probe recursive: a root-only probe misses
a language confined to a sub-package of a monorepo, and that is the accepted
cost of the property being free.

Where no manifest is found, `languageStack` SHALL be an empty array rather than
omitted.

#### Scenario: Root manifests are reported

- **WHEN** a command runs in a workspace whose root contains a `package.json`
  and a `go.mod`
- **THEN** `languageStack` SHALL include the languages both manifests evidence

#### Scenario: No manifests present

- **WHEN** a command runs in a workspace root with no recognized manifest
- **THEN** `languageStack` SHALL be an empty array
- **AND** the property SHALL be present rather than omitted

#### Scenario: The probe does not run the detection scan

- **WHEN** telemetry resolves `languageStack`
- **THEN** it SHALL NOT call `detectRepository`

#### Scenario: A language confined to a sub-package

- **WHEN** a monorepo's root carries only a `package.json` and a Python service
  lives in a sub-directory
- **THEN** `languageStack` SHALL report the root evidence only
- **AND** this SHALL NOT be treated as a defect in the property
