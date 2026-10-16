## MODIFIED Requirements

### Requirement: Init reports every permission edit

Every time `init` edits or creates a harness permission file, its output SHALL name the file and each rule it changed, one per line, labelled so the reader cannot miss that a settings file was touched:

```
Edited .claude/settings.json
  ALLOW: Bash(npx @taskless/cli@0.13.1 *)
  REMOVE: Bash(npx @taskless/cli@0.13.0 *)
```

- `ALLOW: <rule>` for a rule added, rendered in green.
- `REMOVE: <rule>` for a Taskless rule taken out because it is not the installed invocation's rule, whether or not the manifest recorded it, rendered in red.
- `SKIPPED: <file>` with the reason, for a file left alone because it denies the invocation or does not parse, rendered in yellow.

The first line SHALL say `Created` for a file Taskless created and `Edited` for one that existed. The labels SHALL carry the meaning on their own, so the output reads the same with color off (`NO_COLOR`, no TTY). Color SHALL come from the CLI's shared color setup, so it follows the real terminal.

The wizard SHALL show the same lines in its summary step, before anything is written, so the user sees each permission edit before confirming. `--no-interactive` SHALL print them after writing. Under `--json` they SHALL go to stderr with the rest of the human summary, and the envelope SHALL carry the same information as data: per file, the path, whether it was created, the rules allowed and removed, and any skip reason.

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
- **THEN** the summary SHALL show the file and its `ALLOW:` lines before the user confirms
- **AND** nothing SHALL be written if the user cancels

#### Scenario: Color off still reads

- **WHEN** `NO_COLOR` is set
- **THEN** the lines SHALL carry the same `ALLOW:`, `REMOVE:`, and `SKIPPED:` labels with no escape sequences

#### Scenario: JSON carries the edits as data

- **WHEN** `init --json` edits a permission file
- **THEN** the envelope SHALL report that file's path, whether it was created, and the exact rules allowed and removed

## ADDED Requirements

### Requirement: Each permission file holds exactly one Taskless rule

Each harness permission file `init` manages SHALL hold exactly one Taskless rule set afterwards: the rules for the installed invocation, from the table in the requirement that init allows the installed CLI. A Taskless rule is an allow entry, in that harness's format, whose command is an invocation of `@taskless/cli` or `@taskless/cli-nightly` through `npx` or `pnpm dlx`, at any version, with or without a version. For Claude Code this includes both the `Bash(<invocation> *)` form and the `Bash(<invocation>:*)` form. On every `init` the installer SHALL remove each Taskless rule that is not one of the installed invocation's rules, whether or not the manifest recorded it, and write the current ones. It SHALL NOT remove or edit a deny entry, or any entry that is not a Taskless rule.

The manifest SHALL record, under `install.permissions`, each file Taskless wrote a rule to, the exact rule entries it added, and whether Taskless created the file. The record decides only whether a file may be deleted: a file Taskless created SHALL be deleted when removing its entries leaves it holding nothing else; a file that existed before SHALL never be deleted. A recorded file for a harness no longer selected SHALL have its Taskless rules removed.

#### Scenario: An upgrade swaps the version

- **WHEN** the manifest records `Bash(npx @taskless/cli@0.13.0 *)` in `.claude/settings.json` and `init` runs at `0.13.1`
- **THEN** the file SHALL contain `Bash(npx @taskless/cli@0.13.1 *)` and not the `0.13.0` rule
- **AND** the manifest SHALL record only the `0.13.1` rule

#### Scenario: An unrecorded Taskless rule is replaced

- **WHEN** `.claude/settings.json` also holds `Bash(npx @taskless/cli@0.12.0 *)`, which the manifest does not record
- **THEN** an upgrade SHALL remove that entry
- **AND** the file SHALL hold exactly one Taskless rule, for the installed invocation

#### Scenario: The colon form the skill proposed is replaced

- **WHEN** `.claude/settings.json` holds `Bash(npx @taskless/cli-nightly@0.13.0-20261015220659xbf27a23:*)`
- **THEN** `init` SHALL remove it and write the installed invocation's rule

#### Scenario: Other entries are untouched

- **WHEN** `.claude/settings.json` holds `Bash(npx prettier *)` and a deny entry `Bash(npx @taskless/cli@0.11.0 *)`
- **THEN** `init` SHALL leave both entries in place

#### Scenario: A pre-existing file is never deleted

- **WHEN** removing Taskless rules from a `.claude/settings.json` that Taskless did not create leaves its `permissions.allow` empty
- **THEN** the file SHALL remain

## REMOVED Requirements

### Requirement: The manifest records permission rules, and an upgrade replaces only those

**Reason**: An upgrade removed only the rules the manifest recorded, so a Taskless rule added any other way (by hand, or by the agent through the skill's fallback) outlived its version and sat next to the current rule, allowing a build nobody uses. Pins are exact so that a version change is a deliberate act, and the stale rule undermines that.

**Migration**: Replaced by "Each permission file holds exactly one Taskless rule". The first `init` after upgrading removes every Taskless allow rule that is not the installed invocation's and lists each as `REMOVE:`. The manifest record is kept and still decides whether a file Taskless created may be deleted.
