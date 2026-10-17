## MODIFIED Requirements

### Requirement: The global entry names no version and requires one

Each package SHALL have its own entry: the release's begins with the label `Taskless CLI:` and names only `@taskless/cli`; the nightly's begins with the label `Taskless CLI nightly:` and names only `@taskless/cli-nightly`. Neither label SHALL be a prefix of the other's entry. The released build SHALL use the release's entry, and every other build (nightly, `self`) the nightly's. Each entry SHALL state that running its package through `npx` or `pnpm dlx` is allowed only when the call names an exact version, and state that dist-tags such as `@latest` or `@nightly`, version ranges, and unversioned calls are not covered. It SHALL NOT name a version, so an upgrade never makes it stale.

Each entry SHALL also state that the call stays covered when the same command line sets a variable, changes or creates a directory, or redirects the call's output to a file, and that every other command on that line is judged on its own. It SHALL NOT extend coverage to any command other than the pinned Taskless call.

#### Scenario: The entry carries no version

- **WHEN** a package's entry is written by any version of that package
- **THEN** its text SHALL be identical, and SHALL contain no version number other than the fixed example

#### Scenario: Each entry names only its own package

- **WHEN** the release's and the nightly's entries are read
- **THEN** the release's SHALL begin `Taskless CLI:` and SHALL NOT name `@taskless/cli-nightly`
- **AND** the nightly's SHALL begin `Taskless CLI nightly:` and name `@taskless/cli-nightly`

#### Scenario: The entry states the pin requirement

- **WHEN** the entry is read
- **THEN** it SHALL say a call is covered only when it names an exact version
- **AND** it SHALL say `@latest` is not covered

#### Scenario: The entry covers the call inside shell plumbing

- **WHEN** the entry is read
- **THEN** it SHALL say the call stays covered alongside a variable assignment, a directory change or creation, or a redirect of its output to a file
- **AND** it SHALL say every other command on the line is judged on its own

### Requirement: The global entry is detected by its label

`init` SHALL find the entry by this build's label: a string in the harness's list beginning with it is this build's entry, whatever follows. A string beginning with the other package's label SHALL never be read, edited, or removed, so a release and a nightly used on one machine never replace each other's entry. An entry whose whole text equals the current entry SHALL be `present` and SHALL never be rewritten. An entry that carries the label with any other text SHALL be `stale`. A string without this build's label SHALL never be read as this build's entry, edited, or removed.

A stale entry SHALL be replaced only in place, by the current entry, and only where the wizard writes it. When the list holds more than one string carrying the label, the first SHALL be replaced and the rest left as they are.

#### Scenario: A current entry is left alone

- **WHEN** `autoMode.allow` holds the current entry text
- **THEN** `init` SHALL report the entry as present
- **AND** SHALL NOT edit the file

#### Scenario: A reworded entry is left alone

- **WHEN** `autoMode.allow` holds `"Taskless CLI: allowed with a pinned version"`
- **THEN** `init` SHALL report the entry as stale
- **AND** SHALL NOT edit the file, leaving the replacement to the wizard

#### Scenario: An unlabelled entry is never Taskless's

- **WHEN** `autoMode.allow` holds `"Internal Registry: ..."` and no `Taskless CLI:` entry
- **THEN** `init` SHALL report the entry as absent
- **AND** SHALL NOT treat `"Internal Registry: ..."` as stale

#### Scenario: The other package's entry is left alone

- **WHEN** the released build runs and `autoMode.allow` is `["$defaults", <nightly entry>]`
- **THEN** `init` SHALL report the release's entry as absent, not stale
- **AND** writing it SHALL give `["$defaults", <nightly entry>, <release entry>]`

### Requirement: The global entry is offered only in the interactive wizard

When the entry is absent or stale, the wizard SHALL show the proposed edit in its summary step, in the same group as the project permission edits and after them, as one line: `ALLOW (global):` for an absent entry, `REPLACE (global):` for a stale one. The line SHALL name this build's package, say a call is covered only at an exact version, and name the file and key. Project and global edits SHALL be covered by the one confirmation the summary step asks, defaulting to yes; there SHALL be no separate question for the global entry. Declining that confirmation SHALL cancel the install and write nothing, inside or outside the project.

`--no-interactive` and `--json` SHALL NEVER write a file outside the project.

When written, the edit SHALL add the entry to the list, or for a stale entry replace that one string at its position, keeping every other key and entry in the file. When the file or the `allow` list does not exist, the written list SHALL be `["$defaults", <entry>]`, so the harness's shipped exceptions stay in force. When the list exists without `"$defaults"`, `init` SHALL NOT add it, since the user chose to replace the defaults. When the file does not parse, `init` SHALL leave it unchanged and report it as skipped.

Nothing about the entry SHALL be recorded in the project manifest, and a declined offer SHALL NOT be remembered anywhere: every wizard run that finds the entry absent or stale SHALL offer it again.

#### Scenario: The wizard offers the entry

- **WHEN** the wizard installs for `.claude/` and `~/.claude/settings.json` has no entry under this build's label
- **THEN** the summary SHALL show an `ALLOW (global):` line naming `~/.claude/settings.json` and `autoMode.allow`
- **AND** the one confirmation SHALL be `Make these changes to your settings?` when nothing else is being removed

#### Scenario: The wizard offers to replace a stale entry

- **WHEN** the wizard installs for `.claude/` and `autoMode.allow` is `["$defaults", "Taskless CLI: older text", "Internal Registry: ..."]`
- **THEN** the summary SHALL show a `REPLACE (global):` line naming `~/.claude/settings.json` and `autoMode.allow`
- **AND** on confirmation the list SHALL be `["$defaults", <entry>, "Internal Registry: ..."]`

#### Scenario: Declining writes nothing anywhere

- **WHEN** the user declines the summary's confirmation
- **THEN** `~/.claude/settings.json` SHALL be byte-identical afterwards
- **AND** no project permission file SHALL be written

#### Scenario: The global entry alone is still asked

- **WHEN** the project's permission files already hold the installed rule and the entry is absent or stale
- **THEN** the summary SHALL show only the global line and ask the same confirmation

#### Scenario: A declined offer is asked again

- **WHEN** the user declined the entry on an earlier wizard run and it is still absent or stale
- **THEN** the next wizard run SHALL show and ask for it again

#### Scenario: A new list keeps the defaults

- **WHEN** the entry is written to a `~/.claude/settings.json` with no `autoMode` key
- **THEN** `autoMode.allow` SHALL be `["$defaults", <entry>]`
- **AND** every other key in the file SHALL be unchanged

#### Scenario: An existing list is appended to

- **WHEN** `autoMode.allow` is `["$defaults", "Internal Registry: ..."]`
- **THEN** the written list SHALL be `["$defaults", "Internal Registry: ...", <entry>]`

#### Scenario: Non-interactive never writes it

- **WHEN** `init --no-interactive` runs for `.claude/` and the entry is absent or stale
- **THEN** `~/.claude/settings.json` SHALL be byte-identical afterwards

#### Scenario: The manifest does not record it

- **WHEN** the wizard writes the entry
- **THEN** `.taskless/taskless.json` SHALL contain no reference to `~/.claude/settings.json`

### Requirement: A missing global entry is warned about

When a harness in the table is installed for and its entry is absent or stale after `init` finishes, `init` SHALL print a warning, in both modes, naming the harness, the file, the top-level key, and the exact entry to add, saying that without it the harness's classifier may refuse Taskless commands that the project rule allows, and naming the CLI invocation, run with no arguments in a terminal, as the way to be offered it, since `init` itself never asks. For a stale entry the warning SHALL say the existing entry under this build's label is out of date and is to be replaced by the one shown. Under `--json` the warning SHALL go to stderr, and the envelope SHALL report, per harness in the table, the file and whether the entry is present, absent, stale, was written, or was skipped with a reason.

#### Scenario: Non-interactive warns

- **WHEN** `init --no-interactive` runs for `.claude/` and the entry is absent
- **THEN** the output SHALL include a warning naming `~/.claude/settings.json`, `autoMode.allow`, and the entry text
- **AND** the warning SHALL name the installer invocation, run with no arguments in a terminal, as the way to be offered it

#### Scenario: Non-interactive warns about a stale entry

- **WHEN** `init --no-interactive` runs for `.claude/` and the entry is stale
- **THEN** the output SHALL include a warning saying the existing entry under this build's label is out of date, with the current entry text

#### Scenario: A skipped file warns after a wizard install

- **WHEN** the wizard completes an install for `.claude/` and `~/.claude/settings.json` does not parse
- **THEN** the wizard SHALL print the same warning, with the reason the file was left alone

#### Scenario: A present entry is silent

- **WHEN** the entry is present
- **THEN** `init` SHALL print no global trust warning

#### Scenario: JSON reports the state

- **WHEN** `init --json --no-interactive` runs for `.claude/` and the entry is absent
- **THEN** the envelope SHALL report `~/.claude/settings.json` with the entry absent

#### Scenario: JSON reports a stale entry

- **WHEN** `init --json --no-interactive` runs for `.claude/` and the entry is stale
- **THEN** the envelope SHALL report `~/.claude/settings.json` with state `stale`
