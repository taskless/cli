## MODIFIED Requirements

### Requirement: CLI info subcommand outputs version as JSON

The CLI SHALL support a `taskless info` subcommand that outputs a JSON object to stdout. The object SHALL contain the CLI `version`, a `harnesses` array, a `tools` array, a `loggedIn` boolean, a `repositoryUrl`, and a `ghOwner`. The `loggedIn` field SHALL be `true` when a token is available (via `TASKLESS_TOKEN` env var or token file) and `false` otherwise.

`harnesses` SHALL carry the detected agent harnesses — Claude Code, Codex, Cursor, OpenCode. Each entry SHALL include the harness name, a list of installed skills with their versions, and whether each skill is current or outdated compared to the CLI's bundled version. When no harness directories are detected, the `harnesses` array SHALL be empty. This array was published under the key `tools` before this change; only the key moves, and the entry shape is unchanged.

`tools` SHALL carry the command-line binaries this CLI's recipes can make use of. Each entry SHALL include the tool `name`, a `present` boolean, an `applicable` boolean, and a `path` string when and only when the tool is present. `present` SHALL be established by looking for a file of that name on `PATH` and SHALL NOT be established by executing anything: the CLI SHALL NOT spawn a detected binary, SHALL NOT read its version, and SHALL NOT hash it. `applicable` SHALL be `false` when the tool could accomplish nothing in this repository whatever is installed — `gh` in a repository with no GitHub `origin` — and `true` otherwise. The two fields SHALL remain distinct: a tool MAY be present and inapplicable, and that state SHALL NOT be reported as absence.

`repositoryUrl` SHALL be the canonical GitHub repository URL when one is resolvable from the git remote, and `null` otherwise. `ghOwner` SHALL be the owner segment of that URL when resolvable, and the literal `[unknown]` otherwise, matching the value telemetry records. The `applicable` field above SHALL be derived from that same resolution rather than from a second one, so the two cannot disagree.

These fields exist so a caller deciding whether remote generation is available reads the same resolution the CLI enforces, rather than re-deriving the remote itself. `info` carries them because it is already the command consulted for capability state, and is already JSON. No new subcommand SHALL be added for this.

Neither field SHALL make `info` fail: an unresolvable remote is an ordinary state, not an error. Neither SHALL a `PATH` that cannot be read.

#### Scenario: Running taskless info outputs version, tool status, and login status

- **WHEN** a user runs `taskless info` in a repository with Claude Code installed and taskless skills present
- **THEN** stdout SHALL contain a JSON object with `version` (string), `harnesses` (array), `tools` (array), and `loggedIn` (boolean)
- **AND** the `harnesses` array SHALL include an entry for Claude Code with installed skill versions and staleness status

#### Scenario: Info output is valid JSON

- **WHEN** a user runs `taskless info`
- **THEN** the stdout output SHALL be parseable by `JSON.parse()`
- **AND** the resulting object SHALL have a `version` property of type string, a `harnesses` property of type array, a `tools` property of type array, and a `loggedIn` property of type boolean

#### Scenario: Info with no tools detected

- **WHEN** a user runs `taskless info` in a directory with no harness directories
- **THEN** the `harnesses` array in the output SHALL be empty

#### Scenario: Info reports outdated skills

- **WHEN** an installed skill has a `metadata.version` that differs from the CLI's bundled version
- **THEN** the harness entry SHALL indicate the skill is outdated with both the installed and current versions

#### Scenario: Info reports a tool found on PATH

- **WHEN** a user runs `taskless info --json` on a host where `git` is on `PATH`
- **THEN** the `tools` array SHALL contain an entry named `git` with `present: true`
- **AND** that entry SHALL carry the `path` at which it was found

#### Scenario: Info reports a tool missing from PATH without executing anything

- **WHEN** a user runs `taskless info --json` on a host where a detected tool is not on `PATH`
- **THEN** that tool's entry SHALL report `present: false`
- **AND** SHALL carry no `path`
- **AND** the command SHALL NOT have executed any detected binary

#### Scenario: A present tool is inapplicable outside its repository shape

- **WHEN** a user runs `taskless info --json` in a repository with no GitHub `origin`, on a host where `gh` is on `PATH`
- **THEN** the `gh` entry SHALL report `present: true` and `applicable: false`
- **AND** `ghOwner` SHALL be `[unknown]`

#### Scenario: Info reports logged in when token exists

- **WHEN** a token is available via `TASKLESS_TOKEN` env var or token file
- **THEN** `loggedIn` SHALL be `true`

#### Scenario: Info reports not logged in when no token

- **WHEN** no token is available
- **THEN** `loggedIn` SHALL be `false`

#### Scenario: Info reports the repository and owner when a GitHub remote is present

- **WHEN** a user runs `taskless info --json` in a repository whose `origin` is a GitHub URL
- **THEN** `repositoryUrl` SHALL be the canonical `https://github.com/{owner}/{repo}` form
- **AND** `ghOwner` SHALL be that URL's owner segment

#### Scenario: Info reports no repository in each no-remote population

- **WHEN** a user runs `taskless info --json` in a directory that is not a git repository, in a repository with no `origin`, or in a repository whose `origin` is not GitHub
- **THEN** `repositoryUrl` SHALL be `null`
- **AND** `ghOwner` SHALL be `[unknown]`
- **AND** the command SHALL exit successfully
