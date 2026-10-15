## ADDED Requirements

### Requirement: An upgrade removes the retired tskl command

Taskless no longer ships a slash command. The install manifest SHALL keep recording a `commands` list per target, so that an install over an older one removes any `tskl.md` command the prior manifest recorded, from the canonical `.taskless/` store and from each tool directory. Each removal SHALL be confined to the entries the prior manifest recorded for that target.

After removing a recorded command, the CLI SHALL remove that target's `commands/tskl/` directory when it is empty, and for the canonical `.taskless/` target SHALL also remove `.taskless/commands/` when it is empty. A tool directory's own `commands/` directory and any other file in it SHALL be left in place.

When a target's `commands/tskl/` is a symlink, the CLI SHALL remove the symlink itself and SHALL NOT delete any file through it.

The `taskless init --json` envelope SHALL report each removed command in that target's `removedCommands`.

#### Scenario: A recorded command is removed from the canonical store and a tool directory

- **WHEN** the prior manifest records `tskl.md` under both `.taskless` and `.claude`, and `taskless init` runs
- **THEN** `.taskless/commands/tskl/tskl.md` and `.claude/commands/tskl/tskl.md` SHALL be deleted
- **AND** the new manifest SHALL record no commands for either target

#### Scenario: Empty directories go, a tool's other commands stay

- **WHEN** the recorded command is removed and `.claude/commands/` also holds a file Taskless did not write
- **THEN** `.claude/commands/tskl/` and `.taskless/commands/` SHALL no longer exist
- **AND** the other file in `.claude/commands/` SHALL be left untouched

#### Scenario: A symlinked command directory is unlinked, not deleted through

- **WHEN** `.claude/commands/tskl` is a symlink to a directory elsewhere and the prior manifest records `tskl.md` under `.claude`
- **THEN** the symlink SHALL be removed
- **AND** the file it pointed at SHALL be left untouched

#### Scenario: The JSON envelope reports what went

- **WHEN** `taskless init --json` removes a recorded command
- **THEN** the affected target's `removedCommands` SHALL list `tskl.md`

## MODIFIED Requirements

### Requirement: Init subcommand installs skills into a repository

The CLI SHALL support a `taskless init` subcommand that installs the consolidated `taskless` skill into the current working directory's detected tool locations, and upgrades an existing install. `init` SHALL always run the batch install: every detected tool location (or `.agents/` fallback when none detected), without prompting and without an auth step, whether or not a TTY is attached. It is the path an agent, a script, and a CI job take, and the path a person takes to upgrade without answering prompts. The interactive wizard is reached by running the CLI with no subcommand in a TTY, never by `init`.

The `--no-interactive` flag is no longer defined. An invocation that still passes it SHALL behave exactly as `init` without it, so an existing script keeps working.

There is exactly one mandatory skill in v0.7.0 (`taskless`) and zero optional skills. The wizard's optional-skill selection step SHALL be removed.

The `--anonymous` flag is accepted on `init` as a no-op (init does not call the Taskless API directly).

#### Scenario: Running taskless init installs the consolidated skill

- **WHEN** a user runs `taskless init`, in a terminal or under a pipe
- **THEN** the CLI SHALL install the single `taskless` skill to every detected tool location without prompting for tools or auth
- **AND** SHALL NOT launch the wizard

#### Scenario: A legacy --no-interactive flag is harmless

- **WHEN** a script runs `taskless init --no-interactive`
- **THEN** the CLI SHALL behave exactly as for `taskless init`

#### Scenario: Init removes obsolete v0.6 skill files

- **WHEN** a user with v0.6 installed (10 per-task skills written) runs `taskless init`
- **THEN** the install plumbing SHALL read the previous install state from `.taskless/taskless.json`
- **AND** SHALL delete the 10 obsolete skill files and 6 obsolete command files
- **AND** SHALL write the new `taskless` skill and no command
- **AND** SHALL update `.taskless/taskless.json` install state to reflect the new layout

#### Scenario: Init reports cleanup transparently

- **WHEN** init removes obsolete files
- **THEN** the install summary output SHALL include "removed N obsolete skills" and "removed M obsolete commands"
- **AND** SHALL list the obsolete skill names so the user understands what changed

### Requirement: Claude Code detection signals

Claude Code SHALL be detected when any of the following exist in the project root:

- `.claude/` directory
- `CLAUDE.md` file

When `.claude/` is selected, a reference skill stub SHALL be installed to `.claude/skills/<name>/SKILL.md`. No command SHALL be installed.

#### Scenario: Claude Code detected by .claude directory

- **WHEN** `.claude/` exists as a directory in the project root
- **THEN** Claude Code SHALL be detected
- **AND** a reference skill stub SHALL be installed to `.claude/skills/`

#### Scenario: Claude Code detected by CLAUDE.md file

- **WHEN** `CLAUDE.md` exists as a file in the project root
- **AND** `.claude/` directory does not exist
- **THEN** Claude Code SHALL be detected
- **AND** a reference skill stub SHALL be installed to `.claude/skills/`

### Requirement: Cursor detection signals

Cursor SHALL be detected when any of the following exist in the project root:

- `.cursor/` directory
- `.cursorrules` file

When `.cursor/` is selected, a reference skill stub SHALL be installed to `.cursor/skills/<name>/SKILL.md`. No command SHALL be installed.

#### Scenario: Cursor detected by .cursor directory

- **WHEN** `.cursor/` exists as a directory in the project root
- **THEN** Cursor SHALL be detected

#### Scenario: Cursor detected by .cursorrules file

- **WHEN** `.cursorrules` exists as a file in the project root
- **THEN** Cursor SHALL be detected

#### Scenario: Selecting Cursor writes a skill stub and a command stub

- **WHEN** `.cursor/` is selected and `taskless init` runs
- **THEN** a reference skill stub SHALL be written to `.cursor/skills/taskless/SKILL.md`
- **AND** no command file SHALL be written under `.cursor/`

### Requirement: Skills are installed as Agent Skills spec SKILL.md files

The CLI SHALL install skill content using a canonical-store-plus-stub model rather than writing a full copy per detected tool. The full skill content SHALL be written exactly once to the canonical `.taskless/skills/<name>/SKILL.md`. Each selected tool directory SHALL receive its own reference stub as defined by the reference-stub requirement. Skill names SHALL be installed verbatim from the embedded source. No additional namespace prefixing SHALL be applied at install time.

The skill source SHALL name the CLI through the `%(TASKLESS_CLI)s` placeholder, the same token the recipes use, and SHALL NOT contain the literal `npx @taskless/cli` in its body. The canonical write renders the placeholder to the build's own invocation (`npx @taskless/cli` for a release build, the pinned nightly or path-form invocation otherwise). Rendering is an exact-token substitution, not a search for the literal invocation in prose: a literal is whitespace-sensitive, so a wrapped line or a doubled space silently escaped the rewrite and reached a nightly install naming the release package.

#### Scenario: Canonical skill content matches source

- **WHEN** a skill is installed
- **THEN** the canonical `.taskless/skills/<name>/SKILL.md` content SHALL be identical to the embedded source from `skills/` with every `%(TASKLESS_CLI)s` rendered to the build's invocation, which for a release build is `npx @taskless/cli`
- **AND** no frontmatter fields SHALL be modified at install time

#### Scenario: The sources carry the placeholder, not the literal

- **WHEN** the skill source under `skills/` is read
- **THEN** its body SHALL contain `%(TASKLESS_CLI)s` wherever it names the CLI
- **AND** SHALL NOT contain the literal `npx @taskless/cli`
- **AND** the rendered canonical content SHALL contain no unrendered `%(` token

#### Scenario: Selected tool directory receives a stub, not a full copy

- **WHEN** the CLI installs the `taskless` skill and any tool directory is selected
- **THEN** that directory's skill location SHALL contain a reference stub
- **AND** SHALL NOT contain a full copy of the canonical skill content

### Requirement: Skills are bundled into the CLI at build time

The CLI build SHALL embed all skill file content from `skills/` into the compiled bundle using Vite's `import.meta.glob` with raw file imports. No runtime file reads or network fetches SHALL be used to access skill content. The build SHALL embed no command content.

#### Scenario: Embedded skills are available at runtime

- **WHEN** the CLI runs `taskless init`
- **THEN** it SHALL access skill content from the embedded bundle without reading the filesystem or making network requests

#### Scenario: Embedded commands are available at runtime

- **WHEN** the CLI runs `taskless init` for Claude Code
- **THEN** it SHALL have no command content to write, embedded or otherwise

#### Scenario: Build includes all skills from source directory

- **WHEN** `pnpm build` is run in `packages/cli/`
- **THEN** every `SKILL.md` file under `skills/` SHALL be embedded in the output bundle

#### Scenario: Build includes all commands from source directory

- **WHEN** `pnpm build` is run in `packages/cli/`
- **THEN** no command file SHALL be embedded in the output bundle

### Requirement: Wizard prompts the user to choose install locations

The wizard's location step SHALL be presented as a tool-selection step: "which tools do you want to enable Taskless for?". It SHALL offer a fixed catalog of rows: `Claude Code` (`.claude/`), `Codex` (`.agents/`), `Cursor` (`.cursor/`), `OpenCode` (`.opencode/`), and `Agent Skills` (`.agents/`). A row names a tool the user scans for, so more than one row MAY offer the same directory: Codex reads `.agents/`, and a user who arrived from Codex SHALL NOT have to know that before recognising their harness in the list. The generic `Agent Skills` row SHALL remain, since it serves harnesses this catalog does not enumerate.

Every list of directories derived from the catalog SHALL name each directory at most once, however many rows offer it. The pre-checked set SHALL be the union of (a) every directory recorded as a target in the install manifest (`install.targets`) that matches an offered row, and (b) every detected tool's install directory, deduplicated by directory. When the manifest records no targets AND no tools are detected, `.agents/` SHALL be pre-checked as the first-run default. The canonical `.taskless/` store SHALL NOT appear as a selectable entry and SHALL NOT be pre-checked — it is always written and is never a manifest tool-directory target.

Each offered entry SHALL carry an origin hint: `installed` when the entry's directory is recorded in the install manifest; otherwise `detected` when the entry's tool is detected on the filesystem; otherwise `not detected`. The generic `Agent Skills` row MAY instead carry a hint describing it as the generic agent-skills location; a row naming a specific harness SHALL NOT carry that hint. The `installed` hint SHALL take precedence over `detected` when both apply.

Unchecking a pre-checked, manifest-recorded entry SHALL cause the resulting install plan to omit that target, so the existing manifest-diff removal path removes Taskless's reference stubs from that directory. The at-least-one-tool selection rule is unchanged: the wizard SHALL require at least one checked entry.

Each selected directory SHALL produce exactly one `reference` stub target, even when several offered rows name it; the resulting install plan always contains the single `taskless` skill and no command. A directory offered by more than one row SHALL be reported in the install summary under a single label. The function that maps detected tools and manifest targets to multiselect choices SHALL be pure — it SHALL receive both the detected tools and the manifest target list as arguments and SHALL perform no filesystem access — so the mapping is unit-testable.

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

### Requirement: Init prints a post-install onboarding trailer

After a successful install (both wizard and `--no-interactive` paths), `taskless init` SHALL print a single one-line trailer pointing the user at the new onboarding flow. The trailer SHALL be printed AFTER the install summary (the lines that report what was written and any obsolete files removed) and SHALL be the final line of output before the process exits. The trailer SHALL NOT be gated on the value of `install.onboarded` in the manifest — it is informational, printed every successful install. The trailer's wording SHALL be the same for every install plan: every installed target receives the Taskless skill, so the trailer SHALL tell the user to ask their AI tool to onboard with Taskless, naming the Taskless skill, and SHALL NOT mention `/tskl onboard` or a terminal `taskless onboard` command. The trailer SHALL be suppressed when `taskless init` exits non-zero (cancelled wizard, install failure, etc.) or when the install was a no-op (no targets selected, no files to write).

#### Scenario: Wizard install points at the skill only

- **WHEN** a user runs `taskless init` in an interactive terminal and the wizard completes successfully
- **THEN** the final line of output SHALL be a single-line trailer telling the user to ask their AI tool to onboard with the Taskless skill
- **AND** the trailer SHALL NOT mention `/tskl onboard` or `taskless onboard`

#### Scenario: Non-interactive install points at the skill only

- **WHEN** a user runs `taskless init --no-interactive`, whatever tools are detected
- **THEN** the final line of output SHALL be the same skill-only trailer
- **AND** SHALL NOT mention `/tskl onboard` or `taskless onboard`

#### Scenario: Cancelled wizard suppresses the trailer

- **WHEN** a user cancels the wizard (Ctrl-C or equivalent)
- **THEN** the trailer SHALL NOT be printed

#### Scenario: Failed install suppresses the trailer

- **WHEN** `taskless init` exits non-zero due to an install failure
- **THEN** the trailer SHALL NOT be printed

#### Scenario: Trailer is printed regardless of onboarded state

- **WHEN** a user re-runs `taskless init` and `install.onboarded` is already `true`
- **THEN** the trailer SHALL still be printed
- **AND** the trailer wording SHALL be the same skill-only trailer

### Requirement: Skill and command content is installed once to the canonical .taskless store

The CLI SHALL write skill content exactly once per install, to a canonical store inside Taskless's owned `.taskless/` namespace: skill content to `.taskless/skills/<name>/SKILL.md`. The canonical write SHALL occur on every install that contains at least one skill, regardless of which tools are selected. No command content SHALL be written.

The `.taskless/` canonical store SHALL NOT be a tool install target: no tool's detection, install destination, or cleanup logic SHALL point at `.taskless/skills/` or `.taskless/commands/`. This guarantees that no install target can ever delete the canonical content. The canonical target's own removal of a command its prior manifest recorded, as the retired-command requirement describes, is not a tool target's cleanup.

#### Scenario: Canonical content is written once

- **WHEN** `taskless init` runs and the install plan contains the `taskless` skill
- **THEN** the CLI SHALL write the full skill content to `.taskless/skills/taskless/SKILL.md`
- **AND** SHALL NOT write anything under `.taskless/commands/`

#### Scenario: Canonical write happens regardless of selected tools

- **WHEN** `taskless init` runs with any combination of tool directories selected, including none
- **THEN** the canonical `.taskless/` store SHALL be written

#### Scenario: No tool target points at the canonical store

- **WHEN** the install plan is constructed and applied
- **THEN** no tool target's install or cleanup operation SHALL write to or delete `.taskless/skills/` or `.taskless/commands/`

### Requirement: Selected tool directories receive reference stubs

For every selected tool directory, the CLI SHALL write a **reference stub** rather than a full copy. Each selected directory receives its own stub — `.claude/`, `.cursor/`, `.opencode/`, and `.agents/` are peer targets, and no directory is special-cased or routed onto another. A stub SHALL be an ordinary file (never a symlink). A skill stub SHALL contain valid YAML frontmatter with `name` and `description` copied from the canonical skill so the tool can discover and trigger it, plus a `metadata` block carrying `type: shim` (which marks the file as a reference stub) and the canonical `version` (carried for reference and kept in lockstep with the canonical content). Its body SHALL instruct the agent to read the canonical file (`.taskless/skills/<name>/SKILL.md`) and follow it, and SHALL NOT duplicate the canonical content inline. Every stub SHALL point directly at a canonical file, never at another stub.

The CLI SHALL NOT create symlinks for any tool.

The per-directory stub layout is:

- `.claude/skills/<name>/SKILL.md` — Claude Code.
- `.cursor/skills/<name>/SKILL.md` — Cursor.
- `.opencode/skills/<name>/SKILL.md` — OpenCode.
- `.agents/skills/<name>/SKILL.md` — generic Agent Skills location, including Codex.

No directory receives a command stub.

#### Scenario: Skill stub has valid frontmatter and a delegating body

- **WHEN** the CLI writes a skill stub for a selected directory
- **THEN** the stub SHALL be a regular file with frontmatter `name` and `description` matching the canonical skill
- **AND** the stub frontmatter SHALL include `metadata.type: shim`
- **AND** its body SHALL delegate to `.taskless/skills/<name>/SKILL.md` without inlining the canonical instructions

#### Scenario: Each selected directory gets its own stub

- **WHEN** `taskless init` runs with `.cursor/` and `.opencode/` both selected
- **THEN** a skill stub SHALL be written to `.cursor/skills/taskless/SKILL.md`
- **AND** a skill stub SHALL be written to `.opencode/skills/taskless/SKILL.md`

#### Scenario: No symlinks are created

- **WHEN** any `taskless init` or `taskless update` run completes
- **THEN** no skill file or directory written by the CLI SHALL be a symlink

### Requirement: Update rewrites canonical content and preserves reference stubs

`taskless update` SHALL rewrite the canonical `.taskless/skills/` content from the embedded bundle. A canonical file whose bytes already equal what the bundle would write SHALL be left untouched and SHALL NOT be reported as written: the install summary, the `--json` `targets` field, and the upgrade trailer all describe what changed on disk, and a byte-identical rewrite is not a change. For `reference`-mode targets, update SHALL create a stub only if it is missing, and SHALL NOT overwrite an existing stub with full canonical content. Update SHALL re-generate a stub in place only when its frontmatter `name`, `description`, or `metadata.version` has drifted from the canonical content; the stub's delegating body SHALL be preserved.

Update SHALL NOT delete or `rm -rf` the canonical `.taskless/` store, nor any directory that another target sources content from. Removal logic SHALL operate only on entries recorded in the prior manifest and SHALL respect each entry's `mode`.

#### Scenario: Update refreshes canonical content

- **WHEN** `taskless update` runs against an install with a newer bundled skill version
- **THEN** `.taskless/skills/taskless/SKILL.md` SHALL be rewritten with the new content

#### Scenario: An unchanged canonical file is not reported as written

- **WHEN** the install runs and `.taskless/skills/taskless/SKILL.md` already holds exactly what the bundle would write
- **THEN** the file SHALL NOT be rewritten
- **AND** the run's report SHALL NOT list it as written for the `.taskless` target

#### Scenario: Update does not clobber a reference stub

- **WHEN** `taskless update` runs and `.claude/skills/taskless/SKILL.md` is an existing reference stub
- **THEN** update SHALL NOT replace it with full canonical content
- **AND** the stub SHALL continue to delegate to `.taskless/skills/taskless/SKILL.md`

#### Scenario: Update never destroys the canonical store

- **WHEN** `taskless update` processes its targets
- **THEN** it SHALL NOT delete `.taskless/skills/` as part of cleaning up any target
- **AND** the canonical content SHALL remain readable throughout the update

### Requirement: A reference stub says how to restore a missing canonical file

A reference stub's body SHALL state what to do when the canonical file it points at is not present, naming a command that restores it. A stub that only delegates leaves a reader who follows it at a dead end, and the two states that produce a missing canonical file (an install whose untracked files never reached this working directory, and a project that ignores the canonical store) are both reached without anyone doing anything wrong.

The command named SHALL be the one that runs the build which wrote the stub, resolved the same way canonical content resolves it. A stub emitted by a development or nightly build SHALL NOT direct the reader to the released package.

The command named SHALL install without an interactive terminal, since the reader of a stub is typically an agent in a non-interactive context.

Stub content SHALL carry nothing that varies per release, so that adding this instruction changes the footprint outside the canonical store exactly once.

A stub already on disk whose body predates this instruction SHALL be rewritten once by the next install, rather than waiting for its frontmatter to change. Detection of such a stub SHALL NOT depend on the build that wrote it, so that builds with different invocations do not rewrite one another's stubs.

An install SHALL also reclaim a stub whose recovery command names a build other than the one installing, EXCEPT when the command named is the released, version-free one. The released form resolves for every reader, so leaving it in place is what keeps a released build and a nightly from rewriting one another's stub on every install; anything else names a build that may not be reachable at the moment the reader needs it, and is replaced.

#### Scenario: A pinned nightly recovery command is reclaimed by a later install

- **WHEN** an install finds a stub whose recovery command names a version-pinned nightly other than the build installing
- **THEN** the install SHALL rewrite that stub with its own recovery command

#### Scenario: A released recovery command survives a nightly install

- **WHEN** a nightly build installs over a stub whose recovery command is the released, version-free one
- **THEN** the install SHALL leave that stub untouched
- **AND** a subsequent install by either build SHALL leave it untouched

#### Scenario: Stub names the command that restores a missing canonical file

- **WHEN** the CLI writes a skill stub
- **THEN** its body SHALL say what to do if the canonical file does not exist
- **AND** SHALL name a command that restores it

#### Scenario: A development build points at itself

- **WHEN** a `dev` or `self` build writes a stub
- **THEN** the command named SHALL be that build's own invocation
- **AND** SHALL NOT be the released package

#### Scenario: Stub bytes do not move with the CLI version

- **WHEN** two installs of different CLI versions write a stub for the same skill
- **THEN** the two stubs SHALL be identical

#### Scenario: An older stub is rewritten once

- **WHEN** an install finds a stub whose body carries no recovery instruction
- **THEN** the install SHALL rewrite that stub
- **AND** a subsequent install SHALL leave the rewritten stub untouched

## REMOVED Requirements

### Requirement: Claude Code commands are placed from embedded source

**Reason**: Taskless no longer ships the `tskl` slash command. The skill handles every request the command routed, and the command duplicated the skill's preflight and routing text in a second place that had to be kept in step.

**Migration**: Ask the agent in plain language, which engages the `taskless` skill. The next `taskless init` removes `.claude/commands/tskl/tskl.md` (see "An upgrade removes the retired tskl command").

### Requirement: Cursor commands are placed from embedded source

**Reason**: Taskless no longer ships the `tskl` slash command; see the Claude Code requirement above.

**Migration**: Ask the agent in plain language, which engages the `taskless` skill. The next `taskless init` removes `.cursor/commands/tskl/tskl.md`.
