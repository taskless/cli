## ADDED Requirements

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

## MODIFIED Requirements

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
