## MODIFIED Requirements

### Requirement: Init reports every permission edit

Every time `init` edits or creates a harness permission file, its output SHALL name the file and each rule it changed, one per line, labelled so the reader cannot miss that a settings file was touched:

```
Edited .claude/settings.json
  ALLOW: Bash(npx @taskless/cli@0.13.1 *)
  REMOVE: Bash(npx @taskless/cli@0.13.0 *)
```

- `ALLOW: <rule>` for a rule added, rendered in green, since an addition is what the reader needs to notice.
- `REMOVE: <rule>` for a Taskless rule taken out because it is not one of the installed rules, whether or not the manifest recorded it, rendered in the terminal's default color, since removing Taskless's own outdated rules is expected.
- `SKIPPED: <file>` with the reason, for a file left alone because it denies the invocation or does not parse, rendered in red. A skipped edit is one the user has to make by hand, and the Taskless commands it would have allowed can be refused until they do, so it is the only label rendered in red.

The same color for each label SHALL apply wherever a settings edit is shown, project or global, in the wizard and in printed output. `REPLACE`, which only the global trust entry uses, SHALL be rendered in yellow: a change to an existing entry, worth a moment's attention.

The first line SHALL say `Created` for a file Taskless created and `Edited` for one that existed. The labels SHALL carry the meaning on their own, so the output reads the same with color off (`NO_COLOR`, no TTY). Color SHALL come from the CLI's shared color setup, so it follows the real terminal.

The wizard SHALL show each permission edit in its summary step, before anything is written, so the user sees it before confirming, as one statement per command and file, under one heading: `ALLOW (project):`, `REMOVE (project):`, or `SKIPPED (project):`, colored as above, followed by the invocation the rule allows (so a harness whose rules come in two spellings reads as one statement) and, on the next line, `in <file>`; a skip names the file and then the reason. Labels SHALL be padded to the widest label in the group so every statement starts in the same column, and each statement SHALL wrap under itself, on spaces only, to keep lines within 76 columns, so a version token is never split. One confirmation covers every project settings edit: `Make these changes to your settings?`, or, when stubs are also being removed, the removal question extended with `, and make these changes to your settings?`. The global trust entry is asked about in a step of its own, under the `agent-global-trust` capability. `--no-interactive` SHALL print the labelled lines above after writing. Under `--json` they SHALL go to stderr with the rest of the human summary, and the envelope SHALL carry the same information as data: per file, the path, whether it was created, the rules allowed and removed, and any skip reason.

#### Scenario: A first install names the edit

- **WHEN** `init --no-interactive` adds a rule to an existing `.claude/settings.json`
- **THEN** the output SHALL include `Edited .claude/settings.json` followed by `ALLOW: Bash(<invocation> *)`
- **AND** with color on, the `ALLOW` line SHALL be green

#### Scenario: An upgrade shows both sides

- **WHEN** `init` replaces a recorded `0.13.0` rule with the `0.13.1` rule
- **THEN** the output SHALL list `ALLOW:` for the `0.13.1` rule and `REMOVE:` for the `0.13.0` rule under the file's name

#### Scenario: An unrecorded Taskless rule is reported when removed

- **WHEN** `init` removes `Bash(npx @taskless/cli-nightly@0.13.0-20261015220659xbf27a23 *)`, which the manifest did not record
- **THEN** the output SHALL list `REMOVE:` for that rule under the file's name

#### Scenario: The wizard previews before writing

- **WHEN** the wizard reaches its summary step for an install that will edit `.cursor/cli.json`
- **THEN** the summary SHALL show one `ALLOW (project):` statement for the invocation, with `in .cursor/cli.json` beneath it, before the user confirms
- **AND** nothing SHALL be written if the user cancels

#### Scenario: Color off still reads

- **WHEN** `NO_COLOR` is set
- **THEN** the lines SHALL carry the same `ALLOW:`, `REMOVE:`, and `SKIPPED:` labels with no escape sequences

#### Scenario: JSON carries the edits as data

- **WHEN** `init --json` edits a permission file
- **THEN** the envelope SHALL report that file's path, whether it was created, and the exact rules allowed and removed

#### Scenario: Each label has its color

- **WHEN** color is on and `init` reports an added rule, a removed rule, a replaced global entry, and a skipped file
- **THEN** the `ALLOW` line SHALL be green, the `REMOVE` line uncolored, the `REPLACE` line yellow, and the `SKIPPED` line red
