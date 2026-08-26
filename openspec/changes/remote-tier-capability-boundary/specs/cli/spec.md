## MODIFIED Requirements

### Requirement: CLI info subcommand outputs version as JSON

The CLI SHALL support a `taskless info` subcommand that outputs a JSON object to stdout. The object SHALL contain the CLI `version`, a `tools` array, a `loggedIn` boolean, a `repositoryUrl`, and a `ghOwner`. The `loggedIn` field SHALL be `true` when a token is available (via `TASKLESS_TOKEN` env var or token file) and `false` otherwise. Each entry in `tools` SHALL include the tool name, a list of installed skills with their versions, and whether each skill is current or outdated compared to the CLI's bundled version. When no tool directories are detected, the `tools` array SHALL be empty.

`repositoryUrl` SHALL be the canonical GitHub repository URL when one is resolvable from the git remote, and `null` otherwise. `ghOwner` SHALL be the owner segment of that URL when resolvable, and the literal `[unknown]` otherwise, matching the value telemetry records.

These fields exist so a caller deciding whether remote generation is available reads the same resolution the CLI enforces, rather than re-deriving the remote itself. `info` carries them because it is already the command consulted for capability state, and is already JSON. No new subcommand SHALL be added for this.

Neither field SHALL make `info` fail: an unresolvable remote is an ordinary state, not an error.

#### Scenario: Running taskless info outputs version, tool status, and login status

- **WHEN** a user runs `taskless info` in a repository with Claude Code installed and taskless skills present
- **THEN** stdout SHALL contain a JSON object with `version` (string), `tools` (array), and `loggedIn` (boolean)
- **AND** the `tools` array SHALL include an entry for Claude Code with installed skill versions and staleness status

#### Scenario: Info output is valid JSON

- **WHEN** a user runs `taskless info`
- **THEN** the stdout output SHALL be parseable by `JSON.parse()`
- **AND** the resulting object SHALL have a `version` property of type string, a `tools` property of type array, and a `loggedIn` property of type boolean

#### Scenario: Info with no tools detected

- **WHEN** a user runs `taskless info` in a directory with no tool directories
- **THEN** the `tools` array in the output SHALL be empty

#### Scenario: Info reports outdated skills

- **WHEN** an installed skill has a `metadata.version` that differs from the CLI's bundled version
- **THEN** the tool entry SHALL indicate the skill is outdated with both the installed and current versions

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
