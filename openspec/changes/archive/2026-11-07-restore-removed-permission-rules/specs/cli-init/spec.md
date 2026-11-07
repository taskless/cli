## MODIFIED Requirements

### Requirement: Each permission file holds one Taskless rule set per installed package

Each harness permission file `init` manages SHALL hold, afterwards, the installed invocation's package's rules: the rules for the installed invocation, from the table in the requirement that init allows the installed CLI, and the rule for its launcher, from the requirement that init allows the installed launcher. A Taskless rule is an allow entry, in that harness's format, whose command is an invocation of `@taskless/cli` or `@taskless/cli-nightly` through `npx` or `pnpm dlx`, at any version, with or without a version, or whose command is a launcher path `./.taskless/bin/cli.mjs` or `./.taskless/bin/cli-nightly.mjs`. A rule belongs to the package its command names; `cli.mjs` belongs to `@taskless/cli` and `cli-nightly.mjs` to `@taskless/cli-nightly`. For Claude Code this includes both the `Bash(<invocation> *)` form and the `Bash(<invocation>:*)` form. On every `init` the installer SHALL remove each Taskless rule of the installed invocation's package that is not one of the installed invocation's rules, whether or not the manifest recorded it, and write the current ones.

The two packages are not symmetric. A nightly `init` SHALL NOT remove a `@taskless/cli` rule, so a nightly installs beside the release. A release `init` is the move back to mainline: it SHALL remove every `@taskless/cli-nightly` rule in the files it visits, whether or not the manifest recorded it. An invocation that names neither package, such as a `self` build's path, SHALL remove no Taskless rule. The installer SHALL NOT remove or edit a deny entry, or any entry that is not a Taskless rule.

The manifest SHALL record, under `install.permissions`, each file Taskless wrote a rule to, the exact rule entries it added, and whether Taskless created the file. The record decides only whether a file may be deleted. Whether a file holds a rule SHALL be read from the file, never from the record: a recorded rule the file no longer holds SHALL be written again and reported as allowed, and a recorded file that no longer exists SHALL be written again, holding the installed rules, and recorded as one Taskless created. A file Taskless created SHALL be deleted when removing its entries leaves it holding nothing else; a file that existed before SHALL never be deleted. A recorded file for a harness no longer selected SHALL have the installed package's Taskless rules removed, and, on a release `init`, the nightly's. A nightly `init` SHALL keep the release's recorded rules, so a file Taskless created is deleted once the last package's rules leave it.

#### Scenario: An upgrade swaps the version

- **WHEN** the manifest records `Bash(npx @taskless/cli@0.13.0 *)` in `.claude/settings.json` and `init` runs at `0.13.1`
- **THEN** the file SHALL contain `Bash(npx @taskless/cli@0.13.1 *)` and not the `0.13.0` rule
- **AND** the manifest SHALL record only the `0.13.1` rule

#### Scenario: A recorded rule removed from the file is written again

- **WHEN** the manifest records `Bash(npx @taskless/cli@0.13.0 *)` in `.claude/settings.json`, the entry has been removed from the file, and `init` runs at `0.13.0`
- **THEN** the file SHALL contain `Bash(npx @taskless/cli@0.13.0 *)` again
- **AND** `init` SHALL report the file as edited, with that rule as allowed
- **AND** the manifest SHALL record the rule once

#### Scenario: A recorded file that was deleted is written again

- **WHEN** the manifest records `.claude/settings.json` as a file Taskless did not create, the file has been deleted, and `init` runs
- **THEN** `init` SHALL create the file holding the installed rules and report it as created
- **AND** the manifest SHALL record the file as one Taskless created

#### Scenario: A file that agrees with the record is not edited

- **WHEN** `.claude/settings.json` holds exactly the rules the manifest records for the installed invocation, and `init` runs again at the same version
- **THEN** `init` SHALL report no edit and SHALL NOT change the file

#### Scenario: An unrecorded Taskless rule is replaced

- **WHEN** `.claude/settings.json` also holds `Bash(npx @taskless/cli@0.12.0 *)`, which the manifest does not record
- **THEN** an upgrade SHALL remove that entry
- **AND** the file SHALL hold exactly one Taskless rule, for the installed invocation

#### Scenario: The colon form the skill proposed is replaced

- **WHEN** `.claude/settings.json` holds `Bash(npx @taskless/cli-nightly@0.13.0-20261015220659xbf27a23:*)` and a nightly `init` runs
- **THEN** `init` SHALL remove it and write the installed invocation's rule

#### Scenario: Other entries are untouched

- **WHEN** `.claude/settings.json` holds `Bash(npx prettier *)` and a deny entry `Bash(npx @taskless/cli@0.11.0 *)`
- **THEN** `init` SHALL leave both entries in place

#### Scenario: A pre-existing file is never deleted

- **WHEN** removing Taskless rules from a `.claude/settings.json` that Taskless did not create leaves its `permissions.allow` empty
- **THEN** the file SHALL remain

#### Scenario: A nightly installs beside the release's rules

- **WHEN** `init` at `npx @taskless/cli@0.13.0` has written its rule, and a nightly `init` then runs
- **THEN** `.claude/settings.json` SHALL hold the release's rule and the nightly's rule
- **AND** running the nightly's `init` again SHALL report no edit

#### Scenario: A release install removes the nightly's rules

- **WHEN** `.claude/settings.json` holds the release's rules and a nightly's, recorded or not, and the release's `init` runs
- **THEN** every `@taskless/cli-nightly` rule, including `Bash(./.taskless/bin/cli-nightly.mjs *)`, SHALL be removed and reported as removed
- **AND** the release's rules SHALL remain

#### Scenario: A nightly upgrade swaps only the nightly's rule

- **WHEN** `.claude/settings.json` holds the release's rule and an older nightly's rule, and a newer nightly `init` runs
- **THEN** the older nightly rule SHALL be removed and the newer one written
- **AND** the release's rule SHALL remain

#### Scenario: A created file outlives the nightly's removal

- **WHEN** Taskless created `.claude/settings.json` holding the release's and a nightly's rules, and the nightly's `init` runs with `.claude/` no longer selected
- **THEN** the file SHALL remain, holding the release's rule
- **AND** once the release's `init` runs the same way, the file SHALL be deleted

#### Scenario: Removing a harness removes its launcher rule

- **WHEN** the manifest records `Bash(./.taskless/bin/cli-nightly.mjs *)` in `.claude/settings.json` and the nightly's `init` runs with `.claude/` no longer selected
- **THEN** that rule SHALL be removed with the nightly's other Taskless rules
- **AND** `Bash(./.taskless/bin/cli.mjs *)` SHALL remain
