## MODIFIED Requirements

### Requirement: Each permission file holds exactly one Taskless rule

Each harness permission file `init` manages SHALL hold exactly one Taskless rule set per package afterwards: for the installed invocation's package, the rules for the installed invocation, from the table in the requirement that init allows the installed CLI. A Taskless rule is an allow entry, in that harness's format, whose command is an invocation of `@taskless/cli` or `@taskless/cli-nightly` through `npx` or `pnpm dlx`, at any version, with or without a version, and it belongs to the package its command names. For Claude Code this includes both the `Bash(<invocation> *)` form and the `Bash(<invocation>:*)` form. On every `init` the installer SHALL remove each Taskless rule of the installed invocation's package that is not one of the installed invocation's rules, whether or not the manifest recorded it, and write the current ones. It SHALL NOT remove a Taskless rule of the other package, so the release and a nightly installed in one project keep each other's rules. An invocation that names neither package, such as a `self` build's path, SHALL remove no Taskless rule. It SHALL NOT remove or edit a deny entry, or any entry that is not a Taskless rule.

The manifest SHALL record, under `install.permissions`, each file Taskless wrote a rule to, the exact rule entries it added, and whether Taskless created the file. The record decides only whether a file may be deleted: a file Taskless created SHALL be deleted when removing its entries leaves it holding nothing else; a file that existed before SHALL never be deleted. A recorded file for a harness no longer selected SHALL have the installed package's Taskless rules removed. The record SHALL keep the other package's recorded rules, so a file Taskless created is deleted once the last package's rules leave it.

#### Scenario: An upgrade swaps the version

- **WHEN** the manifest records `Bash(npx @taskless/cli@0.13.0 *)` in `.claude/settings.json` and `init` runs at `0.13.1`
- **THEN** the file SHALL contain `Bash(npx @taskless/cli@0.13.1 *)` and not the `0.13.0` rule
- **AND** the manifest SHALL record only the `0.13.1` rule

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

#### Scenario: The release and a nightly keep each other's rules

- **WHEN** `init` at `npx @taskless/cli@0.13.0` has written its rule, and a nightly `init` then runs
- **THEN** `.claude/settings.json` SHALL hold the release's rule and the nightly's rule
- **AND** running either `init` again SHALL report no edit

#### Scenario: A nightly upgrade swaps only the nightly's rule

- **WHEN** `.claude/settings.json` holds the release's rule and an older nightly's rule, and a newer nightly `init` runs
- **THEN** the older nightly rule SHALL be removed and the newer one written
- **AND** the release's rule SHALL remain

#### Scenario: A created file outlives one package's removal

- **WHEN** Taskless created `.claude/settings.json` holding the release's and a nightly's rules, and the release's `init` runs with `.claude/` no longer selected
- **THEN** the file SHALL remain, holding the nightly's rule
- **AND** once the nightly's `init` runs the same way, the file SHALL be deleted
