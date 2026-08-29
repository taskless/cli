## MODIFIED Requirements

### Requirement: Wizard prompts the user to choose install locations

The wizard's location step SHALL be presented as a tool-selection step: "which tools do you want to enable Taskless for?". It SHALL offer a fixed catalog of rows: `Claude Code` (`.claude/`), `Codex` (`.agents/`), `Cursor` (`.cursor/`), `OpenCode` (`.opencode/`), and `Agent Skills` (`.agents/`). A row names a tool the user scans for, so more than one row MAY offer the same directory: Codex reads `.agents/`, and a user who arrived from Codex SHALL NOT have to know that before recognising their harness in the list. The generic `Agent Skills` row SHALL remain, since it serves harnesses this catalog does not enumerate.

Every list of directories derived from the catalog SHALL name each directory at most once, however many rows offer it. The pre-checked set SHALL be the union of (a) every directory recorded as a target in the install manifest (`install.targets`) that matches an offered row, and (b) every detected tool's install directory, deduplicated by directory. When the manifest records no targets AND no tools are detected, `.agents/` SHALL be pre-checked as the first-run default. The canonical `.taskless/` store SHALL NOT appear as a selectable entry and SHALL NOT be pre-checked — it is always written and is never a manifest tool-directory target.

Each offered entry SHALL carry an origin hint: `installed` when the entry's directory is recorded in the install manifest; otherwise `detected` when the entry's tool is detected on the filesystem; otherwise `not detected`. The generic `Agent Skills` row MAY instead carry a hint describing it as the generic agent-skills location; a row naming a specific harness SHALL NOT carry that hint. The `installed` hint SHALL take precedence over `detected` when both apply.

Unchecking a pre-checked, manifest-recorded entry SHALL cause the resulting install plan to omit that target, so the existing manifest-diff removal path removes Taskless's reference stubs from that directory. The at-least-one-tool selection rule is unchanged: the wizard SHALL require at least one checked entry.

Each selected directory SHALL produce exactly one `reference` stub target, even when several offered rows name it; the resulting install plan always contains the single `taskless` skill (and, for `.claude/` and `.cursor/`, the `tskl` command). A directory offered by more than one row SHALL be reported in the install summary under a single label. The function that maps detected tools and manifest targets to multiselect choices SHALL be pure — it SHALL receive both the detected tools and the manifest target list as arguments and SHALL perform no filesystem access — so the mapping is unit-testable.

#### Scenario: Codex is named in the tool list

- **WHEN** the wizard renders the tool-selection multiselect
- **THEN** a `Codex` entry SHALL be offered for `.agents/`
- **AND** a separate generic `Agent Skills` entry SHALL also be offered for `.agents/`

#### Scenario: A directory offered by two rows is pre-checked once

- **WHEN** the wizard reaches the tool-selection step and Codex is detected
- **THEN** `.agents/` SHALL appear exactly once in the pre-checked set

#### Scenario: A directory offered by two rows installs once

- **WHEN** the user's selection includes `.agents/`, whichever of its rows was checked
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
