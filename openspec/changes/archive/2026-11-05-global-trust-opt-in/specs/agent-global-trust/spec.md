## MODIFIED Requirements

### Requirement: The global entry is offered only in the interactive wizard

When the entry is absent or stale, the wizard SHALL ask about it in its own step, after the summary step's confirmation and before anything is written, inside or outside the project. The step SHALL show one line: `ALLOW (global):` for an absent entry, `REPLACE (global):` for a stale one. The line SHALL name this build's package, say a call is covered only at an exact version, and name the file and key.

Before asking, the step SHALL explain, in the same text whichever build runs it apart from the package and launcher names:

- that the launcher and the version it runs are in the project, where they can be read;
- why a project rule does not reach the harness's classifier, and that the classifier cannot see the pin;
- that this is the only file the installer changes outside the project, and that the entry applies to every project on the machine, including a launcher at the same path in another repository;
- the entry's exact text;
- that dist-tags, version ranges, and unversioned calls are not covered, and that removing the entry undoes it;
- that Taskless installs either way, and that without the entry the harness may ask for approval or refuse Taskless commands.

The question SHALL default to no. Declining it SHALL leave the file byte-identical and the install SHALL continue, printing one line that names the cost and how to be offered the entry again. Cancelling the prompt SHALL cancel the install and write nothing, inside or outside the project. Declining the summary's confirmation SHALL cancel the install, write nothing, and not ask this question.

`--no-interactive` and `--json` SHALL NEVER write a file outside the project.

When written, the edit SHALL add the entry to the list, or for a stale entry replace that one string at its position, keeping every other key and entry in the file. When the file or the `allow` list does not exist, the written list SHALL be `["$defaults", <entry>]`, so the harness's shipped exceptions stay in force. When the list exists without `"$defaults"`, `init` SHALL NOT add it, since the user chose to replace the defaults. When the file does not parse, `init` SHALL leave it unchanged and report it as skipped.

Nothing about the entry SHALL be recorded in the project manifest, and a declined offer SHALL NOT be remembered anywhere: every wizard run that finds the entry absent or stale SHALL offer it again.

#### Scenario: The wizard offers the entry

- **WHEN** the wizard installs for `.claude/` and `~/.claude/settings.json` has no entry under this build's label
- **THEN** the wizard SHALL show an `ALLOW (global):` line naming `~/.claude/settings.json` and `autoMode.allow`, with the explanation
- **AND** SHALL ask its own question, defaulting to no, after the summary's confirmation

#### Scenario: The wizard offers to replace a stale entry

- **WHEN** the wizard installs for `.claude/` and `autoMode.allow` is `["$defaults", "Taskless CLI: older text", "Internal Registry: ..."]`
- **THEN** the wizard SHALL show a `REPLACE (global):` line naming `~/.claude/settings.json` and `autoMode.allow`
- **AND** on confirmation the list SHALL be `["$defaults", <entry>, "Internal Registry: ..."]`

#### Scenario: Declining writes nothing anywhere

- **WHEN** the user declines the summary's confirmation
- **THEN** `~/.claude/settings.json` SHALL be byte-identical afterwards
- **AND** no project permission file SHALL be written
- **AND** the wizard SHALL NOT ask about the global entry

#### Scenario: Declining the entry still installs

- **WHEN** the user confirms the summary and declines the global entry
- **THEN** `~/.claude/settings.json` SHALL be byte-identical afterwards
- **AND** the install SHALL complete, with the project permission rule written
- **AND** the wizard SHALL print one line, and no `SKIPPED (global):` block

#### Scenario: Cancelling the question writes nothing anywhere

- **WHEN** the user cancels the prompt that asks about the global entry
- **THEN** `~/.claude/settings.json` SHALL be byte-identical afterwards
- **AND** no project file SHALL be written

#### Scenario: The question defaults to no

- **WHEN** the wizard asks about the global entry
- **THEN** pressing Enter SHALL decline it

#### Scenario: The step shows the exact entry

- **WHEN** the wizard asks about the global entry
- **THEN** the step SHALL show the entry's text, word for word, before the question
- **AND** SHALL say the entry applies to every project on the machine

#### Scenario: The global entry alone is still asked

- **WHEN** the project's permission files already hold the installed rule and the entry is absent or stale
- **THEN** the summary SHALL show no settings group and ask nothing
- **AND** the wizard SHALL ask only the global entry's question

#### Scenario: A declined offer is asked again

- **WHEN** the user declined the entry on an earlier wizard run and it is still absent or stale
- **THEN** the next wizard run SHALL show the step and ask again

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

When a harness in the table is installed for and its entry is absent or stale after `init` finishes, and the person did not just decline it in the wizard, `init` SHALL print a `SKIPPED (global):` line in red, in both modes, as the reporting of permission edits colors a skip, followed by text naming the harness, the file, the top-level key, and the exact entry to add, saying that without it the harness's classifier may refuse Taskless commands that the project rule allows, and naming the CLI invocation, run with no arguments in a terminal, as the way to be offered it, since `init` itself never asks. A skip is an edit the user has to make by hand, which is why it is red; `init` SHALL NOT make it for them. For a stale entry the text SHALL say the existing entry under this build's label is out of date and is to be replaced by the one shown. Under `--json` this output SHALL go to stderr, and the envelope SHALL report, per harness in the table, the file and whether the entry is present, absent, stale, was written, or was skipped with a reason.

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

#### Scenario: A decline is not warned about

- **WHEN** the user declines the entry in the wizard
- **THEN** the wizard SHALL NOT print a `SKIPPED (global):` block

#### Scenario: A present entry is silent

- **WHEN** the entry is present
- **THEN** `init` SHALL print no global trust warning

#### Scenario: JSON reports the state

- **WHEN** `init --json --no-interactive` runs for `.claude/` and the entry is absent
- **THEN** the envelope SHALL report `~/.claude/settings.json` with the entry absent

#### Scenario: JSON reports a stale entry

- **WHEN** `init --json --no-interactive` runs for `.claude/` and the entry is stale
- **THEN** the envelope SHALL report `~/.claude/settings.json` with state `stale`

#### Scenario: The skip is red

- **WHEN** color is on and `init --no-interactive` runs for `.claude/` with the entry absent
- **THEN** the output SHALL include a red `SKIPPED (global):` line naming `~/.claude/settings.json`

### Requirement: Cleanup of the global entry runs on every install and upgrade

The check for this build's global entry, including folding duplicates, SHALL run on every `init`, whether it is a first install or an upgrade, and SHALL NOT be a scaffold migration: migrations run on every write path, including `--no-interactive` and CI, and the entry lives outside the project. The wizard SHALL perform the whole cleanup in the one edit its global entry question confirms, shown as a single `REPLACE (global):` line, never as one line per removed string. When the entry is stale because of duplicates, the `SKIPPED (global):` output that `init` prints otherwise SHALL say how many strings carry the label and that the wizard will fold them into one.

#### Scenario: Non-interactive names the duplicates

- **WHEN** `init --no-interactive` runs for `.claude/` and `autoMode.allow` holds two strings carrying this build's label
- **THEN** `~/.claude/settings.json` SHALL be byte-identical afterwards
- **AND** the `SKIPPED (global):` output SHALL say two strings carry the label and that running the installer with no arguments in a terminal folds them into one

#### Scenario: One confirmation covers the fold

- **WHEN** the wizard finds three strings carrying this build's label
- **THEN** the wizard SHALL show one `REPLACE (global):` line for them
- **AND** declining SHALL leave the file byte-identical
