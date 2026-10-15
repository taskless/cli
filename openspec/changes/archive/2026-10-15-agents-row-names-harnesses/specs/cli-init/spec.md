## MODIFIED Requirements

### Requirement: Wizard prompts the user to choose install locations

The wizard's location step SHALL be presented as a tool-selection step: "which tools do you want to enable Taskless for?". It SHALL offer one row per directory: `Claude Code` (`.claude/`), `Cursor` (`.cursor/`), `OpenCode` (`.opencode/`), and a row for `.agents/`. A user who arrived from a harness that reads `.agents/` SHALL NOT have to know that before recognising their harness in the list, so the `.agents/` row SHALL be labelled with harness names: the detected harnesses whose own documentation says they read `.agents/skills` (OpenCode, Codex, Gemini CLI, Crush), in catalog order, followed by `and other .agents harnesses`, for example `OpenCode, Codex, and other .agents harnesses (.agents/)`. When none of them is detected, the row SHALL name all of them, so a harness is still recognisable on a machine where nothing is detected.

Every list of directories derived from the catalog SHALL name each directory at most once, however many detected tools install into it. The pre-checked set SHALL be the union of (a) every directory recorded as a target in the install manifest (`install.targets`) that matches an offered row, and (b) every detected tool's install directory, deduplicated by directory. When the manifest records no targets AND no tools are detected, `.agents/` SHALL be pre-checked as the first-run default. The canonical `.taskless/` store SHALL NOT appear as a selectable entry and SHALL NOT be pre-checked — it is always written and is never a manifest tool-directory target.

Each offered entry SHALL carry an origin hint: `installed` when the entry's directory is recorded in the install manifest; otherwise `detected` when a detected tool installs into the entry's directory; otherwise `not detected`. A harness named on the `.agents/` row only because it reads `.agents/skills`, such as OpenCode, whose own directory is `.opencode/`, SHALL NOT make that row `detected` or pre-check it, since installing into both directories would give that harness the skill twice. The `installed` hint SHALL take precedence over `detected` when both apply.

Unchecking a pre-checked, manifest-recorded entry SHALL cause the resulting install plan to omit that target, so the existing manifest-diff removal path removes Taskless's reference stubs from that directory. The at-least-one-tool selection rule is unchanged: the wizard SHALL require at least one checked entry.

Each selected directory SHALL produce exactly one `reference` stub target; the resulting install plan always contains the single `taskless` skill and no command. The `.agents/` target SHALL be reported in the install summary as `Agent Skills`. The function that maps detected tools and manifest targets to multiselect choices SHALL be pure — it SHALL receive both the detected tools and the manifest target list as arguments and SHALL perform no filesystem access — so the mapping is unit-testable.

#### Scenario: Codex is named in the tool list

- **WHEN** the wizard renders the tool-selection multiselect with Codex detected, or with no `.agents` harness detected
- **THEN** the `.agents/` row's label SHALL name `Codex`
- **AND** exactly one entry SHALL be offered for `.agents/`

#### Scenario: Detected .agents harnesses are named in catalog order

- **WHEN** Codex and OpenCode are detected
- **THEN** the `.agents/` row SHALL be labelled `OpenCode, Codex, and other .agents harnesses (.agents/)`

#### Scenario: OpenCode is named without pre-checking .agents

- **WHEN** OpenCode is the only detected tool
- **THEN** the `.agents/` row's label SHALL name OpenCode
- **AND** `.agents/` SHALL NOT be pre-checked and SHALL carry the `not detected` hint

#### Scenario: A directory offered by two rows is pre-checked once

- **WHEN** the wizard reaches the tool-selection step and Codex, Gemini CLI, and Crush are all detected
- **THEN** `.agents/` SHALL appear exactly once in the pre-checked set

#### Scenario: A directory offered by two rows installs once

- **WHEN** the user's selection includes `.agents/`
- **THEN** the install plan SHALL contain exactly one `.agents/` target
- **AND** the `.agents/` skill stub SHALL be written once

#### Scenario: Detected tools are pre-checked

- **WHEN** the wizard reaches the tool-selection step and `.claude/` is detected
- **THEN** `.claude/` SHALL be pre-checked in the multiselect
- **AND** `.claude/` SHALL carry the `detected` hint when it is not recorded in the install manifest

#### Scenario: Manifest-recorded locations are pre-checked

- **WHEN** the wizard reaches the tool-selection step and the install manifest records `.agents/` as a target
- **THEN** `.agents/` SHALL be pre-checked in the multiselect
- **AND** `.agents/` SHALL carry the `installed` hint

#### Scenario: Installed hint takes precedence over detected

- **WHEN** the wizard reaches the tool-selection step and `.claude/` is both detected on the filesystem and recorded in the install manifest
- **THEN** `.claude/` SHALL be pre-checked
- **AND** `.claude/` SHALL carry the `installed` hint, not the `detected` hint

#### Scenario: Unchecking an installed location removes its stubs

- **WHEN** the install manifest records `.claude/` and `.agents/` as targets and the user unchecks `.claude/` while leaving `.agents/` checked
- **THEN** the resulting install plan SHALL omit the `.claude/` target
- **AND** the wizard summary SHALL list the `.claude/` reference stubs as removals

#### Scenario: Agents is the default when nothing is detected or installed

- **WHEN** the wizard reaches the tool-selection step, no tools are detected, and the install manifest records no tool-directory targets
- **THEN** `.agents/` SHALL be pre-checked

#### Scenario: Canonical store is not a selectable entry

- **WHEN** the wizard renders the tool-selection multiselect
- **THEN** `.taskless/` SHALL NOT appear as a selectable option
- **AND** `.taskless/` SHALL NOT be pre-checked even though the manifest records it as a target

## ADDED Requirements

### Requirement: Gemini CLI and Crush detection signals

Gemini CLI and Crush SHALL be detected as harnesses that read `.agents/skills`, from their own documentation: Gemini CLI reads workspace skills from `.gemini/skills/` "or the `.agents/skills/` alias", and Crush lists `.agents/skills` among its project skill directories. Each SHALL install into `.agents/`.

Gemini CLI SHALL be detected when a `.gemini/` directory or a `GEMINI.md` file exists in the project root. Crush SHALL be detected when a `.crush/` directory, or a `.crushrc`, `crushrc`, `crush.json`, or `.crush.json` file, exists in the project root.

#### Scenario: Gemini CLI detected by its directory

- **WHEN** `.gemini/` exists in the project root
- **THEN** Gemini CLI SHALL be detected
- **AND** skills SHALL be installed to `.agents/skills/`

#### Scenario: Crush detected by its directory

- **WHEN** `.crush/` exists in the project root
- **THEN** Crush SHALL be detected
- **AND** skills SHALL be installed to `.agents/skills/`
