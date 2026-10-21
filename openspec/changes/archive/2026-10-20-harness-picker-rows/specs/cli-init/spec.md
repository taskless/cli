## ADDED Requirements

### Requirement: Devin detection signals

Devin SHALL be detected when a `.devin/` directory exists in the project root. Devin reads project skills from `.devin/skills` and from `.agents/skills`. When Devin is detected in the project, its skill SHALL be installed to `.devin/skills/<name>/SKILL.md`; otherwise selecting Devin SHALL install to `.agents/skills/<name>/SKILL.md`. Taskless SHALL NOT create `.devin/` in a project that does not already have it. Devin SHALL receive no permission rule and no commands.

#### Scenario: Devin detected by .devin directory

- **WHEN** `.devin/` exists as a directory in the project root
- **THEN** Devin SHALL be detected
- **AND** its skill SHALL be installed to `.devin/skills/`

#### Scenario: Devin without .devin installs into .agents

- **WHEN** the wizard's Devin row is checked and `.devin/` does not exist in the project root
- **THEN** the install plan SHALL contain an `.agents/` target
- **AND** the install plan SHALL NOT contain a `.devin/` target

### Requirement: Machine-level harness detection

The wizard SHALL detect which catalog harnesses are present on this machine from each harness's documented home-directory location, honouring its documented environment override: Claude Code `~/.claude` (`CLAUDE_CONFIG_DIR`), Codex `~/.codex` (`CODEX_HOME`), Cursor `~/.cursor` (`CURSOR_CONFIG_DIR`), OpenCode `~/.config/opencode` (`OPENCODE_CONFIG_DIR`), Gemini CLI `.gemini` under the home directory or under `GEMINI_CLI_HOME`, Crush `~/.config/crush` (`CRUSH_GLOBAL_CONFIG`) or `~/.local/share/crush` (`CRUSH_GLOBAL_DATA`), Devin `~/.config/devin`. A harness SHALL be machine-detected when any of its locations is a directory.

Machine detection SHALL only decide which section of the tool-selection step a harness's row is shown in. It SHALL NOT pre-check a row, SHALL NOT change where a skill is installed, and SHALL NOT cause any file to be written outside the project root. The home directory and environment SHALL be passed in, so detection is testable without the real home directory.

#### Scenario: A harness in the home directory is machine-detected

- **WHEN** `~/.codex/` exists and the project has no Codex signal
- **THEN** Codex SHALL be machine-detected

#### Scenario: An override relocates the home signal

- **WHEN** `CLAUDE_CONFIG_DIR` names an existing directory and `~/.claude/` does not exist
- **THEN** Claude Code SHALL be machine-detected

#### Scenario: Machine detection writes nothing outside the project

- **WHEN** the wizard completes an install with machine-detected harnesses checked
- **THEN** every skill file written SHALL be inside the project root

### Requirement: Wizard offers a row per harness

The wizard's location step SHALL be presented as a tool-selection step: "which tools do you want to enable Taskless for?". It SHALL offer one row per catalog harness, whatever is detected: Claude Code, OpenCode, Cursor, Codex, Gemini CLI, Crush, Devin, in catalog order, and a final generic row `Other Agent Skills harnesses (.agents/)`. Each row's label SHALL name the harness and the directory it installs into, for example `Codex (.agents/)`. Several rows MAY install into the same directory.

The rows SHALL be grouped into sections, in this order, omitting an empty section: `Detected in this project` (harnesses with a project detection signal), `Detected on this machine` (harnesses machine-detected but not detected in the project), and `Other harnesses` (the rest, and always the generic row). A harness detected in both the project and the machine SHALL appear once, in `Detected in this project`. Section headers SHALL NOT be selectable.

The pre-checked rows SHALL be (a) every row in `Detected in this project`, and (b) for each directory recorded as a target in the install manifest (`install.targets`) that no row from (a) installs into, the row that installs into it, which for `.agents/` is the generic row. When neither applies, the generic row SHALL be pre-checked as the first-run default. Machine-detected rows SHALL NOT be pre-checked. A pre-checked row whose directory is recorded in the manifest SHALL carry the hint `installed`; no other hint is shown. The canonical `.taskless/` store SHALL NOT appear as a selectable entry and SHALL NOT be pre-checked: it is always written and is never a manifest tool-directory target.

Claude Code SHALL always install into `.claude/`, since Claude Code does not read skills from `.agents/`.

The checked rows SHALL resolve to the set of directories they install into, each directory once, and each selected directory SHALL produce exactly one `reference` stub target; the resulting install plan always contains the single `taskless` skill and no command. Unchecking every row that installs into a manifest-recorded directory SHALL cause the resulting install plan to omit that target, so the existing manifest-diff removal path removes Taskless's reference stubs from that directory. The wizard SHALL require at least one checked row. The `.agents/` target SHALL be reported in the install summary as `Agent Skills`. The function that maps detected harnesses and manifest targets to rows SHALL be pure: it SHALL receive the project-detected harnesses, the machine-detected harnesses and the manifest target list as arguments and SHALL perform no filesystem access, so the mapping is unit-testable.

#### Scenario: Codex is visible with nothing detected

- **WHEN** the wizard renders the tool-selection step with no harness detected in the project or on the machine
- **THEN** a row labelled `Codex (.agents/)` SHALL be offered
- **AND** a row SHALL be offered for every catalog harness

#### Scenario: Project-detected harnesses are pre-checked in their own section

- **WHEN** `.claude/` and `.codex/` exist in the project root
- **THEN** the Claude Code and Codex rows SHALL be in `Detected in this project`
- **AND** both SHALL be pre-checked

#### Scenario: Machine-detected harnesses are listed unchecked

- **WHEN** Gemini CLI is machine-detected and not detected in the project
- **THEN** the Gemini CLI row SHALL be in `Detected on this machine`
- **AND** it SHALL NOT be pre-checked

#### Scenario: A harness detected in both places appears once

- **WHEN** Claude Code is detected in the project and on the machine
- **THEN** exactly one Claude Code row SHALL be offered, in `Detected in this project`

#### Scenario: Two checked rows sharing a directory install once

- **WHEN** the Codex and Gemini CLI rows are both checked
- **THEN** the install plan SHALL contain exactly one `.agents/` target

#### Scenario: Manifest-recorded locations are pre-checked

- **WHEN** the install manifest records `.agents/` as a target and no harness that installs into `.agents/` is detected in the project
- **THEN** the generic row SHALL be pre-checked
- **AND** it SHALL carry the `installed` hint

#### Scenario: Unchecking an installed location removes its stubs

- **WHEN** the install manifest records `.claude/` and `.agents/` as targets and the user unchecks Claude Code while leaving a row that installs into `.agents/` checked
- **THEN** the resulting install plan SHALL omit the `.claude/` target
- **AND** the wizard summary SHALL list the `.claude/` reference stubs as removals

#### Scenario: The generic row is the default when nothing is detected or installed

- **WHEN** no harness is detected in the project and the install manifest records no tool-directory targets
- **THEN** the generic `Other Agent Skills harnesses (.agents/)` row SHALL be the only pre-checked row

#### Scenario: Claude Code on the machine only still installs into .claude

- **WHEN** Claude Code is machine-detected, the project has no Claude Code signal, and the user checks the Claude Code row
- **THEN** the install plan SHALL contain a `.claude/` target and no `.agents/` target

#### Scenario: Canonical store is not a selectable entry

- **WHEN** the wizard renders the tool-selection step
- **THEN** `.taskless/` SHALL NOT appear as a selectable option
- **AND** no row SHALL be pre-checked because the manifest records `.taskless/`

## MODIFIED Requirements

### Requirement: Init allows the installed CLI in each harness's permission file

`taskless init`, in the wizard and in `--no-interactive`, SHALL write a rule allowing exactly the installed CLI invocation to the project permission file of each harness it installs the skill for, from this table:

| Harness         | When                                                                        | File                                                                                                                | Rule                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code     | `.claude/` selected                                                         | `.claude/settings.json`                                                                                             | `permissions.allow`: `Bash(<invocation> *)`                                                                                                     |
| Cursor (editor) | `.cursor/` selected                                                         | `.cursor/permissions.json`                                                                                          | `terminalAllowlist`: `<invocation>`                                                                                                             |
| Cursor (CLI)    | `.cursor/` selected                                                         | `.cursor/cli.json`                                                                                                  | `permissions.allow`: `Shell(npx:<specifier>)` and `Shell(npx:<specifier> *)`                                                                    |
| OpenCode        | `.opencode/` selected                                                       | the existing `opencode.json` or `opencode.jsonc`, at the root or under `.opencode/`, else `.opencode/opencode.json` | object form: `permission.bash["<invocation> *"]: "allow"`; array form: `{ "action": "shell", "resource": "<invocation> *", "effect": "allow" }` |
| Codex           | the wizard's Codex row is checked; in `--no-interactive`, Codex is detected | `.codex/rules/taskless.rules`                                                                                       | `prefix_rule(pattern=["npx", "<specifier>"], decision="allow")`                                                                                 |

Each rule SHALL use that harness's word-bounded form, so it matches the invocation alone or followed by arguments and SHALL NOT match a longer version string. No rule SHALL wildcard the package name or version. The generic `.agents/` target has no permission file and SHALL receive none. The table is exhaustive: `init` SHALL NOT write a permission rule for any harness not listed in it. Harnesses that read the skill from `.agents/` (other than Codex), harnesses with no file-based allowlist such as Cline, and harnesses whose allowlist can only allow a whole tool such as Crush SHALL receive none.

In OpenCode's object form the entry SHALL be placed after every existing key, since the last matching rule wins; in the array form it SHALL be placed first.

How each edit is reported is defined by the requirement that init reports every permission edit.

#### Scenario: An unlisted harness gets no rule

- **WHEN** `init` runs in a project with a harness configuration directory that is not in the table
- **THEN** `init` SHALL NOT create or edit any file in it

#### Scenario: Claude Code gets a pinned rule

- **WHEN** `init` installs for `.claude/` with invocation `npx @taskless/cli@0.13.0`
- **THEN** `.claude/settings.json` SHALL contain `Bash(npx @taskless/cli@0.13.0 *)` in `permissions.allow`
- **AND** every other key and entry in the file SHALL be unchanged

#### Scenario: The rule does not match another version

- **WHEN** the rule for `npx @taskless/cli@0.13.0` is written for any harness
- **THEN** under that harness's documented matching it SHALL NOT match `npx @taskless/cli@0.13.01`

#### Scenario: OpenCode object form puts the rule last

- **WHEN** `opencode.json` has `permission.bash` with `"*": "ask"`
- **THEN** the Taskless key SHALL follow `"*"` in the written object

#### Scenario: OpenCode array form puts the rule first

- **WHEN** the OpenCode file uses the array form under `permissions`
- **THEN** the Taskless entry SHALL be the first element

#### Scenario: Codex gets a rules file only when detected

- **WHEN** `init --no-interactive` runs and no Codex detection signal is present
- **THEN** `init` SHALL NOT create `.codex/`

#### Scenario: Checking the Codex row writes its rules file

- **WHEN** the wizard's Codex row is the only checked row and the project has no `.codex/`
- **THEN** the skill SHALL be installed to `.agents/skills/`
- **AND** `.codex/rules/taskless.rules` SHALL be written

#### Scenario: Another .agents row does not write Codex's rules file

- **WHEN** the wizard's generic or Gemini CLI row is checked, the Codex row is not, and the project has no `.codex/`
- **THEN** `init` SHALL NOT create `.codex/`

#### Scenario: OpenCode comments survive

- **WHEN** the OpenCode file is `opencode.jsonc` with comments
- **THEN** the written file SHALL keep every comment

## REMOVED Requirements

### Requirement: Wizard prompts the user to choose install locations

**Reason**: Its one-row-per-directory picker named a harness only when detected, so a Codex user with nothing detected saw only "Agent Skills" and concluded Codex was unsupported (#553).

**Migration**: Replaced by "Wizard offers a row per harness", which keeps the manifest pre-check, the at-least-one rule, the `.taskless/` exclusion and the one-target-per-directory plan.
