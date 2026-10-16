# agent-global-trust Specification

## Purpose

Carries the trust a user grants by installing Taskless into agents whose safety classifier overrules project allow rules, through one user-level entry that a human confirms once during the interactive install.

## Requirements

### Requirement: Harnesses with a global trust entry

A harness SHALL have a global trust entry only when its safety classifier can refuse a command that the project permission file allows, and its user-level settings accept a written exception. The list is closed and SHALL be exactly:

| Harness     | File                      | Location                                    |
| ----------- | ------------------------- | ------------------------------------------- |
| Claude Code | `~/.claude/settings.json` | top-level `autoMode.allow`, a list of prose |

A harness SHALL be considered only when `init` installs the skill for it, by the same selection that decides its project permission rule. No other harness SHALL receive a global entry, read or written, until it is added to this table.

#### Scenario: Only Claude Code is considered

- **WHEN** `init` installs for `.cursor/` and `.opencode/` only
- **THEN** `init` SHALL NOT read or write any file outside the project for a global trust entry

#### Scenario: Claude Code is considered when selected

- **WHEN** `init` installs for `.claude/`
- **THEN** `init` SHALL read `~/.claude/settings.json` to look for the entry

### Requirement: The global entry names no version and requires one

The entry SHALL begin with the label `Taskless CLI:`. It SHALL name `@taskless/cli` and `@taskless/cli-nightly`, state that running either through `npx` or `pnpm dlx` is allowed only when the call names an exact version, and state that dist-tags such as `@latest` or `@nightly`, version ranges, and unversioned calls are not covered. It SHALL NOT name a version, so an upgrade never makes it stale.

#### Scenario: The entry carries no version

- **WHEN** the entry is written by any version of the CLI
- **THEN** its text SHALL be identical, and SHALL contain no version number

#### Scenario: The entry states the pin requirement

- **WHEN** the entry is read
- **THEN** it SHALL say a call is covered only when it names an exact version
- **AND** it SHALL say `@latest` is not covered

### Requirement: The global entry is detected by its label

`init` SHALL treat the entry as present when the harness's list holds any string beginning with `Taskless CLI:`, whatever follows the label. A present entry SHALL never be rewritten, replaced, or removed.

#### Scenario: A reworded entry is left alone

- **WHEN** `autoMode.allow` holds `"Taskless CLI: allowed with a pinned version"`
- **THEN** `init` SHALL treat the entry as present
- **AND** SHALL NOT edit the file

### Requirement: The global entry is offered only in the interactive wizard

When the entry is absent, the wizard SHALL show the proposed edit in its summary step, in the same group as the project permission edits and after them, as one line labelled `ALLOW (global):` that names the packages, says a call is covered only at an exact version, and names the file and key. Project and global edits SHALL be covered by the one confirmation the summary step asks, defaulting to yes; there SHALL be no separate question for the global entry. Declining that confirmation SHALL cancel the install and write nothing, inside or outside the project.

`--no-interactive` and `--json` SHALL NEVER write a file outside the project.

When written, the edit SHALL add the entry to the list, keeping every other key and entry in the file. When the file or the `allow` list does not exist, the written list SHALL be `["$defaults", <entry>]`, so the harness's shipped exceptions stay in force. When the list exists without `"$defaults"`, `init` SHALL NOT add it, since the user chose to replace the defaults. When the file does not parse, `init` SHALL leave it unchanged and report it as skipped.

Nothing about the entry SHALL be recorded in the project manifest, and a declined offer SHALL NOT be remembered anywhere: every wizard run that does not find the entry SHALL offer it again.

#### Scenario: The wizard offers the entry

- **WHEN** the wizard installs for `.claude/` and `~/.claude/settings.json` has no `Taskless CLI:` entry
- **THEN** the summary SHALL show an `ALLOW (global):` line naming `~/.claude/settings.json` and `autoMode.allow`
- **AND** the one confirmation SHALL be `Make these changes to your settings?` when nothing else is being removed

#### Scenario: Declining writes nothing anywhere

- **WHEN** the user declines the summary's confirmation
- **THEN** `~/.claude/settings.json` SHALL be byte-identical afterwards
- **AND** no project permission file SHALL be written

#### Scenario: The global entry alone is still asked

- **WHEN** the project's permission files already hold the installed rule and the entry is absent
- **THEN** the summary SHALL show only the `ALLOW (global):` line and ask the same confirmation

#### Scenario: A declined offer is asked again

- **WHEN** the user declined the entry on an earlier wizard run and it is still absent
- **THEN** the next wizard run SHALL show and ask for it again

#### Scenario: A new list keeps the defaults

- **WHEN** the entry is written to a `~/.claude/settings.json` with no `autoMode` key
- **THEN** `autoMode.allow` SHALL be `["$defaults", <entry>]`
- **AND** every other key in the file SHALL be unchanged

#### Scenario: An existing list is appended to

- **WHEN** `autoMode.allow` is `["$defaults", "Internal Registry: ..."]`
- **THEN** the written list SHALL be `["$defaults", "Internal Registry: ...", <entry>]`

#### Scenario: Non-interactive never writes it

- **WHEN** `init --no-interactive` runs for `.claude/` and the entry is absent
- **THEN** `~/.claude/settings.json` SHALL be byte-identical afterwards

#### Scenario: The manifest does not record it

- **WHEN** the wizard writes the entry
- **THEN** `.taskless/taskless.json` SHALL contain no reference to `~/.claude/settings.json`

### Requirement: A missing global entry is warned about

When a harness in the table is installed for and its entry is absent after `init` finishes, `init` SHALL print a warning, in both modes, naming the harness, the file, the top-level key, and the exact entry to add, saying that without it the harness's classifier may refuse Taskless commands that the project rule allows, and naming the CLI invocation, run with no arguments in a terminal, as the way to be offered it, since `init` itself never asks. Under `--json` the warning SHALL go to stderr, and the envelope SHALL report, per harness in the table, the file and whether the entry is present, was written, or was skipped with a reason.

#### Scenario: Non-interactive warns

- **WHEN** `init --no-interactive` runs for `.claude/` and the entry is absent
- **THEN** the output SHALL include a warning naming `~/.claude/settings.json`, `autoMode.allow`, and the entry text
- **AND** the warning SHALL name the installer invocation, run with no arguments in a terminal, as the way to be offered it

#### Scenario: A skipped file warns after a wizard install

- **WHEN** the wizard completes an install for `.claude/` and `~/.claude/settings.json` does not parse
- **THEN** the wizard SHALL print the same warning, with the reason the file was left alone

#### Scenario: A present entry is silent

- **WHEN** the entry is present
- **THEN** `init` SHALL print no global trust warning

#### Scenario: JSON reports the state

- **WHEN** `init --json --no-interactive` runs for `.claude/` and the entry is absent
- **THEN** the envelope SHALL report `~/.claude/settings.json` with the entry absent
