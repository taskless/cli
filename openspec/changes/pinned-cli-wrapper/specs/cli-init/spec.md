## ADDED Requirements

### Requirement: Init installs the package's launcher and records its version

Every `init` that writes the canonical skill, in the wizard and in `--no-interactive`, SHALL also write this build's launcher, as defined by the `cli-project-launcher` capability, and record this build's version for its package under `install.launchers` in `.taskless/taskless.json`, keyed by package name. It SHALL keep the other package's recorded version. `install.cliVersion` SHALL keep recording the build that last installed.

A launcher whose bytes differ from this build's launcher SHALL be rewritten, and the install summary SHALL name it as restored, since a launcher runs whatever it contains under any rule that allows it. A `self` build SHALL write no launcher and record no version under `install.launchers`.

No scaffold migration SHALL be added for this: the launcher and its record are install output, written by the same step as the canonical skill.

#### Scenario: A release install records its version

- **WHEN** `init` runs from the release at `0.13.0` in a project with no `install.launchers`
- **THEN** `install.launchers` SHALL be `{ "@taskless/cli": "0.13.0" }`
- **AND** `install.cliVersion` SHALL be `0.13.0`

#### Scenario: A nightly install keeps the release's version

- **WHEN** `install.launchers` is `{ "@taskless/cli": "0.13.0" }` and a nightly `init` runs at `0.14.0-20261020120000xabc1234`
- **THEN** `install.launchers` SHALL be `{ "@taskless/cli": "0.13.0", "@taskless/cli-nightly": "0.14.0-20261020120000xabc1234" }`
- **AND** `install.cliVersion` SHALL be `0.14.0-20261020120000xabc1234`

#### Scenario: An edited launcher is restored and reported

- **WHEN** `.taskless/bin/cli.mjs` was edited and the release's `init` runs
- **THEN** the file SHALL hold this build's launcher afterwards
- **AND** the summary SHALL name `.taskless/bin/cli.mjs` as restored

### Requirement: Init allows the installed launcher in each harness's permission file

Alongside the rules for the installed invocation, `init` SHALL write a rule allowing this build's launcher, spelled `./.taskless/bin/<launcher>` with no version, to the same permission file of each harness it writes a rule for, in that harness's word-bounded form:

| Harness         | Launcher rule                                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code     | `permissions.allow`: `Bash(./.taskless/bin/<launcher> *)`                                                                                                                   |
| Cursor (editor) | `terminalAllowlist`: `./.taskless/bin/<launcher>`                                                                                                                           |
| Cursor (CLI)    | `permissions.allow`: `Shell(./.taskless/bin/<launcher>)`                                                                                                                    |
| OpenCode        | object form: `permission.bash["./.taskless/bin/<launcher> *"]: "allow"`; array form: `{ "action": "shell", "resource": "./.taskless/bin/<launcher> *", "effect": "allow" }` |
| Codex           | `prefix_rule(pattern=["./.taskless/bin/<launcher>"], decision="allow")`                                                                                                     |

A harness whose rule format cannot match a command given as a relative path SHALL receive no launcher rule, and that SHALL be recorded in this table rather than approximated. The launcher rule SHALL be reported, recorded, and placed exactly as the invocation's rules are, by the requirements that init reports every permission edit and that each permission file holds exactly one Taskless rule set per package. A `self` build SHALL write no launcher rule.

#### Scenario: Claude Code gets the launcher rule

- **WHEN** the release's `init` installs for `.claude/` at `0.13.0`
- **THEN** `.claude/settings.json` SHALL contain `Bash(npx @taskless/cli@0.13.0 *)` and `Bash(./.taskless/bin/cli.mjs *)` in `permissions.allow`

#### Scenario: The launcher rule survives an upgrade

- **WHEN** `.claude/settings.json` holds the release's rules for `0.13.0` and the release's `init` runs at `0.13.1`
- **THEN** `Bash(./.taskless/bin/cli.mjs *)` SHALL remain, and SHALL NOT be reported as an edit

#### Scenario: The nightly's launcher rule names its own launcher

- **WHEN** a nightly `init` installs for `.claude/`
- **THEN** `.claude/settings.json` SHALL contain `Bash(./.taskless/bin/cli-nightly.mjs *)`
- **AND** SHALL NOT gain `Bash(./.taskless/bin/cli.mjs *)`

## MODIFIED Requirements

### Requirement: Skills are installed as Agent Skills spec SKILL.md files

The CLI SHALL install skill content using a canonical-store-plus-stub model rather than writing a full copy per detected tool. The full skill content SHALL be written exactly once to the canonical `.taskless/skills/<name>/SKILL.md`. Each selected tool directory SHALL receive its own reference stub as defined by the reference-stub requirement. Skill names SHALL be installed verbatim from the embedded source. No additional namespace prefixing SHALL be applied at install time.

The skill source SHALL name the CLI through the `%(TASKLESS_CLI)s` placeholder, the same token the recipes use, and SHALL NOT contain the literal `npx @taskless/cli` in its body. The canonical write renders the placeholder to this build's launcher, `./.taskless/bin/cli.mjs` for a release build and `./.taskless/bin/cli-nightly.mjs` for a nightly, so the rendered skill does not change between versions of one package. A `self` build, which installs no launcher, renders its path-form invocation. Rendering is an exact-token substitution, not a search for the literal invocation in prose: a literal is whitespace-sensitive, so a wrapped line or a doubled space silently escaped the rewrite and reached a nightly install naming the release package.

A reference stub's recovery command is not rendered to the launcher. It SHALL keep naming the build's pinned invocation, since it exists for when the canonical store, and the launcher with it, is missing.

#### Scenario: Canonical skill content matches source

- **WHEN** a skill is installed
- **THEN** the canonical `.taskless/skills/<name>/SKILL.md` content SHALL be identical to the embedded source from `skills/` with every `%(TASKLESS_CLI)s` rendered to the build's launcher, which for a release build is `./.taskless/bin/cli.mjs`
- **AND** no frontmatter fields SHALL be modified at install time

#### Scenario: The rendered skill does not move with the version

- **WHEN** the release's `init` runs at `0.13.0` and then at `0.13.1`, and the skill source did not change between them
- **THEN** the canonical `SKILL.md` SHALL be byte-identical after both

#### Scenario: A stub's recovery command keeps the pinned invocation

- **WHEN** the release's `init` at `0.13.0` writes a reference stub
- **THEN** the stub's recovery command SHALL name `npx @taskless/cli@0.13.0`

#### Scenario: The sources carry the placeholder, not the literal

- **WHEN** the skill source under `skills/` is read
- **THEN** its body SHALL contain `%(TASKLESS_CLI)s` wherever it names the CLI
- **AND** SHALL NOT contain the literal `npx @taskless/cli`
- **AND** the rendered canonical content SHALL contain no unrendered `%(` token

#### Scenario: Selected tool directory receives a stub, not a full copy

- **WHEN** the CLI installs the `taskless` skill and any tool directory is selected
- **THEN** that directory's skill location SHALL contain a reference stub
- **AND** SHALL NOT contain a full copy of the canonical skill content

### Requirement: Each permission file holds exactly one Taskless rule

Each harness permission file `init` manages SHALL hold exactly one Taskless rule set per package afterwards: for the installed invocation's package, the rules for the installed invocation, from the table in the requirement that init allows the installed CLI, and the rule for its launcher, from the requirement that init allows the installed launcher. A Taskless rule is an allow entry, in that harness's format, whose command is an invocation of `@taskless/cli` or `@taskless/cli-nightly` through `npx` or `pnpm dlx`, at any version, with or without a version, or whose command is a launcher path `./.taskless/bin/cli.mjs` or `./.taskless/bin/cli-nightly.mjs`. A rule belongs to the package its command names; `cli.mjs` belongs to `@taskless/cli` and `cli-nightly.mjs` to `@taskless/cli-nightly`. For Claude Code this includes both the `Bash(<invocation> *)` form and the `Bash(<invocation>:*)` form. On every `init` the installer SHALL remove each Taskless rule of the installed invocation's package that is not one of the installed invocation's rules, whether or not the manifest recorded it, and write the current ones. It SHALL NOT remove a Taskless rule of the other package, so the release and a nightly installed in one project keep each other's rules. An invocation that names neither package, such as a `self` build's path, SHALL remove no Taskless rule. It SHALL NOT remove or edit a deny entry, or any entry that is not a Taskless rule.

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

#### Scenario: Removing a harness removes its launcher rule

- **WHEN** the manifest records `Bash(./.taskless/bin/cli.mjs *)` in `.claude/settings.json` and the release's `init` runs with `.claude/` no longer selected
- **THEN** that rule SHALL be removed with the release's other Taskless rules
- **AND** `Bash(./.taskless/bin/cli-nightly.mjs *)` SHALL remain

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

The same color for each label SHALL apply wherever a settings edit is shown, project or global, in the wizard's summary and in printed output. `REPLACE`, which only the global trust entry uses, SHALL be rendered in yellow: a change to an existing entry, worth a moment's attention.

The first line SHALL say `Created` for a file Taskless created and `Edited` for one that existed. The labels SHALL carry the meaning on their own, so the output reads the same with color off (`NO_COLOR`, no TTY). Color SHALL come from the CLI's shared color setup, so it follows the real terminal.

The wizard SHALL show each permission edit in its summary step, before anything is written, so the user sees it before confirming, as one statement per command and file, grouped with any global trust edit under one heading: `ALLOW (project):`, `REMOVE (project):`, or `SKIPPED (project):`, colored as above, followed by the invocation the rule allows (so a harness whose rules come in two spellings reads as one statement) and, on the next line, `in <file>`; a skip names the file and then the reason. Labels SHALL be padded to the widest label in the group so every statement starts in the same column, and each statement SHALL wrap under itself, on spaces only, to keep lines within 76 columns, so a version token is never split. One confirmation covers every settings edit: `Make these changes to your settings?`, or, when stubs are also being removed, the removal question extended with `, and make these changes to your settings?`. `--no-interactive` SHALL print the labelled lines above after writing. Under `--json` they SHALL go to stderr with the rest of the human summary, and the envelope SHALL carry the same information as data: per file, the path, whether it was created, the rules allowed and removed, and any skip reason.

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
