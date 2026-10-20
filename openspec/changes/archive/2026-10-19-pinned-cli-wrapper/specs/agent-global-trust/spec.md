## MODIFIED Requirements

### Requirement: The global entry names no version and requires one

Each package SHALL have its own entry: the release's begins with the label `Taskless CLI:` and names only `@taskless/cli`; the nightly's begins with the label `Taskless CLI nightly:` and names only `@taskless/cli-nightly`. Neither label SHALL be a prefix of the other's entry. The released build SHALL use the release's entry, and every other build (nightly, `self`) the nightly's. Each entry SHALL state that running its package through `npx` or `pnpm dlx` is allowed only when the call names an exact version, and state that dist-tags such as `@latest` or `@nightly`, version ranges, and unversioned calls are not covered. Each entry SHALL also state that running its package's launcher from the project root (`./.taskless/bin/cli.mjs` for the release, `./.taskless/bin/cli-nightly.mjs` for the nightly) is allowed with any arguments, and that the launcher runs the exact version the project recorded for that package. It SHALL NOT name the other package's launcher. It SHALL NOT name a version, so an upgrade never makes it stale. Changing the entry to cover the launcher makes every entry written before it stale, which the wizard replaces as it replaces any stale entry.

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

#### Scenario: The entry covers its own launcher

- **WHEN** the release's entry is read
- **THEN** it SHALL say running `./.taskless/bin/cli.mjs` from the project root is allowed
- **AND** it SHALL NOT name `cli-nightly.mjs`

#### Scenario: An entry from before the launcher is stale

- **WHEN** `autoMode.allow` holds the release's entry as written before this change
- **THEN** `init` SHALL report it as stale

### Requirement: The global entry is detected by its label

`init` SHALL find the entry by this build's label: a string in the harness's list beginning with it is this build's entry, whatever follows. A string beginning with the other package's label SHALL never be read, edited, or removed, so a release and a nightly used on one machine never replace each other's entry. The entry SHALL be `present` when exactly one string carries this build's label and its whole text equals the current entry, and a present entry SHALL never be rewritten. It SHALL be `stale` when any string carrying the label has other text, or when more than one string carries the label, even if one of them is current. A string without this build's label SHALL never be read as this build's entry, edited, or removed.

A stale entry SHALL be replaced only where the wizard writes it, and the replacement SHALL leave exactly one string carrying the label: the first such string SHALL be replaced in place by the current entry, and every later string carrying the label SHALL be removed. Strings carrying the other package's label, and strings with no Taskless label, SHALL keep their text and their order.

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

#### Scenario: Duplicate entries fold into one

- **WHEN** the wizard installs for `.claude/` and `autoMode.allow` is `["$defaults", <current entry>, "Internal Registry: ...", "Taskless CLI: pasted by hand", <nightly entry>]`
- **THEN** `init` SHALL report the entry as stale
- **AND** on confirmation the list SHALL be `["$defaults", <current entry>, "Internal Registry: ...", <nightly entry>]`

#### Scenario: A current entry with a duplicate is not present

- **WHEN** `autoMode.allow` holds the current entry twice
- **THEN** `init` SHALL report the entry as stale
- **AND** the wizard SHALL leave one copy, at the first one's position

### Requirement: A missing global entry is warned about

When a harness in the table is installed for and its entry is absent or stale after `init` finishes, `init` SHALL print a `SKIPPED (global):` line in red, in both modes, as the reporting of permission edits colors a skip, followed by text naming the harness, the file, the top-level key, and the exact entry to add, saying that without it the harness's classifier may refuse Taskless commands that the project rule allows, and naming the CLI invocation, run with no arguments in a terminal, as the way to be offered it, since `init` itself never asks. A skip is an edit the user has to make by hand, which is why it is red; `init` SHALL NOT make it for them. For a stale entry the text SHALL say the existing entry under this build's label is out of date and is to be replaced by the one shown. Under `--json` this output SHALL go to stderr, and the envelope SHALL report, per harness in the table, the file and whether the entry is present, absent, stale, was written, or was skipped with a reason.

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

#### Scenario: The skip is red

- **WHEN** color is on and `init --no-interactive` runs for `.claude/` with the entry absent
- **THEN** the output SHALL include a red `SKIPPED (global):` line naming `~/.claude/settings.json`

## ADDED Requirements

### Requirement: Cleanup of the global entry runs on every install and upgrade

The check for this build's global entry, including folding duplicates, SHALL run on every `init`, whether it is a first install or an upgrade, and SHALL NOT be a scaffold migration: migrations run on every write path, including `--no-interactive` and CI, and the entry lives outside the project. The wizard SHALL perform the whole cleanup in the one edit its summary step confirms, shown as a single `REPLACE (global):` line, never as one line per removed string. When the entry is stale because of duplicates, the `SKIPPED (global):` output that `init` prints otherwise SHALL say how many strings carry the label and that the wizard will fold them into one.

#### Scenario: Non-interactive names the duplicates

- **WHEN** `init --no-interactive` runs for `.claude/` and `autoMode.allow` holds two strings carrying this build's label
- **THEN** `~/.claude/settings.json` SHALL be byte-identical afterwards
- **AND** the `SKIPPED (global):` output SHALL say two strings carry the label and that running the installer with no arguments in a terminal folds them into one

#### Scenario: One confirmation covers the fold

- **WHEN** the wizard finds three strings carrying this build's label
- **THEN** the summary SHALL show one `REPLACE (global):` line for them
- **AND** declining SHALL leave the file byte-identical
