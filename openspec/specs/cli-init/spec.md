# CLI Init

## Purpose

TBD — Defines the `taskless init` subcommand that installs Taskless skills into a repository by detecting AI tools and writing skill files.

## Requirements

### Requirement: Init subcommand installs skills into a repository

The CLI SHALL support a `taskless init` subcommand that installs the consolidated `taskless` skill into the current working directory's detected tool locations. The subcommand SHALL also be available as `taskless update` (alias). By default, `init` SHALL launch the interactive wizard. When invoked with `--no-interactive`, `init` SHALL preserve the prior batch-install behavior: install the consolidated skill to every detected tool location (or `.agents/` fallback when none detected) without prompting and without an auth step.

There is exactly one mandatory skill in v0.7.0 (`taskless`) and zero optional skills. The wizard's optional-skill selection step SHALL be removed.

The `--anonymous` flag is accepted on `init` as a no-op (init does not call the Taskless API directly).

#### Scenario: Running taskless init installs the consolidated skill

- **WHEN** a user runs `taskless init` in an interactive terminal
- **THEN** the wizard SHALL prompt for tool locations and auth, then install the single `taskless` skill
- **AND** SHALL NOT prompt for optional skills (none exist)

#### Scenario: Init removes obsolete v0.6 skill files

- **WHEN** a user with v0.6 installed (10 per-task skills written) runs the v0.7.0 `taskless init`
- **THEN** the install plumbing SHALL read the previous install state from `.taskless/taskless.json`
- **AND** SHALL delete the 10 obsolete skill files and 6 obsolete command files
- **AND** SHALL write the new `taskless` skill and `tskl` command
- **AND** SHALL update `.taskless/taskless.json` install state to reflect the new layout

#### Scenario: Init reports cleanup transparently

- **WHEN** init removes obsolete files
- **THEN** the install summary output SHALL include "removed N obsolete skills" and "removed M obsolete commands"
- **AND** SHALL list the obsolete skill names so the user understands what changed

### Requirement: Tool detection via filesystem inspection

The CLI SHALL detect installed AI tools by checking for known detection signals (files and directories) via parallel filesystem checks. Detection SHALL NOT rely on parsing configuration file contents or other tool-specific metadata; config-style files MAY be used only as file-presence signals. The tool registry SHALL be a typed array of tool descriptors maintained in `packages/cli/src/install/install.ts`. Each tool descriptor SHALL have a `detect` array of signals and a separate `installDir` for the install root.

#### Scenario: Claude Code is detected

- **WHEN** a `.claude/` directory or `CLAUDE.md` file exists in the working directory
- **THEN** the CLI SHALL detect Claude Code as an installed tool

#### Scenario: OpenCode is detected

- **WHEN** a `.opencode/` directory, `opencode.jsonc` file, or `opencode.json` file exists in the working directory
- **THEN** the CLI SHALL detect OpenCode as an installed tool

#### Scenario: Cursor is detected

- **WHEN** a `.cursor/` directory or `.cursorrules` file exists in the working directory
- **THEN** the CLI SHALL detect Cursor as an installed tool

#### Scenario: Multiple tools are detected

- **WHEN** multiple known tool signals exist (e.g., `.claude/` and `.cursor/`)
- **THEN** the CLI SHALL detect all of them and install skills for each

#### Scenario: No tools detected triggers fallback

- **WHEN** no known tool signals exist in the working directory
- **THEN** the CLI SHALL install skills to `.agents/skills/` as a fallback

### Requirement: Tool descriptor separates detection from install path

Each tool in the registry SHALL have a `detect` array of signals and a separate `installDir` string. Detection signals SHALL be objects with a `type` field (`"directory"` or `"file"`) and a `path` field relative to the project root.

#### Scenario: Tool detected by directory signal

- **WHEN** a tool descriptor has `{ type: "directory", path: ".claude" }` in its `detect` array
- **AND** `.claude/` exists as a directory in the project root
- **THEN** the tool SHALL be detected

#### Scenario: Tool detected by file signal

- **WHEN** a tool descriptor has `{ type: "file", path: "CLAUDE.md" }` in its `detect` array
- **AND** `CLAUDE.md` exists as a file in the project root
- **THEN** the tool SHALL be detected

#### Scenario: Tool detected by any matching signal

- **WHEN** a tool descriptor has multiple signals in its `detect` array
- **AND** at least one signal matches a file or directory in the project root
- **THEN** the tool SHALL be detected

#### Scenario: Tool not detected when no signals match

- **WHEN** no signals in a tool's `detect` array match files or directories in the project root
- **THEN** the tool SHALL NOT be detected

### Requirement: Claude Code detection signals

Claude Code SHALL be detected when any of the following exist in the project root:

- `.claude/` directory
- `CLAUDE.md` file

When `.claude/` is selected, a reference skill stub SHALL be installed to `.claude/skills/<name>/SKILL.md` and a reference command stub to `.claude/commands/tskl/<name>.md`.

#### Scenario: Claude Code detected by .claude directory

- **WHEN** `.claude/` exists as a directory in the project root
- **THEN** Claude Code SHALL be detected
- **AND** a reference skill stub SHALL be installed to `.claude/skills/`

#### Scenario: Claude Code detected by CLAUDE.md file

- **WHEN** `CLAUDE.md` exists as a file in the project root
- **AND** `.claude/` directory does not exist
- **THEN** Claude Code SHALL be detected
- **AND** a reference skill stub SHALL be installed to `.claude/skills/`

### Requirement: OpenCode detection signals

OpenCode SHALL be detected when any of the following exist in the project root:

- `.opencode/` directory
- `opencode.jsonc` file
- `opencode.json` file

When `.opencode/` is selected, a reference skill stub SHALL be installed to `.opencode/skills/<name>/SKILL.md`. OpenCode SHALL NOT receive commands.

#### Scenario: OpenCode detected by .opencode directory

- **WHEN** `.opencode/` exists as a directory in the project root
- **THEN** OpenCode SHALL be detected

#### Scenario: OpenCode detected by opencode.jsonc file

- **WHEN** `opencode.jsonc` exists as a file in the project root
- **THEN** OpenCode SHALL be detected

#### Scenario: OpenCode detected by opencode.json file

- **WHEN** `opencode.json` exists as a file in the project root
- **THEN** OpenCode SHALL be detected

#### Scenario: Selecting OpenCode writes a stub to .opencode/skills

- **WHEN** `.opencode/` is selected and `taskless init` runs
- **THEN** a reference skill stub SHALL be written to `.opencode/skills/taskless/SKILL.md`
- **AND** no command file SHALL be written under `.opencode/`

### Requirement: Cursor detection signals

Cursor SHALL be detected when any of the following exist in the project root:

- `.cursor/` directory
- `.cursorrules` file

When `.cursor/` is selected, a reference skill stub SHALL be installed to `.cursor/skills/<name>/SKILL.md` and a reference command stub to `.cursor/commands/tskl/<name>.md`.

#### Scenario: Cursor detected by .cursor directory

- **WHEN** `.cursor/` exists as a directory in the project root
- **THEN** Cursor SHALL be detected

#### Scenario: Cursor detected by .cursorrules file

- **WHEN** `.cursorrules` exists as a file in the project root
- **THEN** Cursor SHALL be detected

#### Scenario: Selecting Cursor writes a skill stub and a command stub

- **WHEN** `.cursor/` is selected and `taskless init` runs
- **THEN** a reference skill stub SHALL be written to `.cursor/skills/taskless/SKILL.md`
- **AND** a reference command stub SHALL be written to `.cursor/commands/tskl/`

### Requirement: Codex detection signals

OpenAI Codex SHALL be detected when any of the following exist in the project root:

- `.codex/` directory
- `.codex/config.toml` file

Skills SHALL be installed to `.agents/skills/<name>/SKILL.md` (Codex's documented read path). Codex SHALL NOT receive commands — Codex's custom slash commands are deprecated upstream and the official replacement is skills.

#### Scenario: Codex detected by .codex directory

- **WHEN** `.codex/` exists as a directory in the project root
- **THEN** Codex SHALL be detected
- **AND** skills SHALL be installed to `.agents/skills/`

#### Scenario: Codex detected by .codex/config.toml file

- **WHEN** `.codex/config.toml` exists as a file in the project root
- **THEN** Codex SHALL be detected
- **AND** skills SHALL be installed to `.agents/skills/`

#### Scenario: Codex detected alongside other tools

- **WHEN** `.codex/` exists and `.claude/` exists in the project root
- **THEN** both Codex and Claude Code SHALL be detected
- **AND** skills SHALL be installed to `.agents/skills/` for Codex
- **AND** skills SHALL be installed to `.claude/skills/` for Claude Code

#### Scenario: Codex does not receive commands

- **WHEN** Codex is detected and the install plan is built
- **THEN** no command files SHALL be written for Codex

### Requirement: Codex install destination overrides the fallback for the same directory

When Codex is detected, the install plan SHALL treat `.agents/` as the Codex target rather than the generic agents fallback. The state-based cleanup helper that resolves a tool descriptor by `installDir` SHALL prefer registered tool entries (including Codex) over the `AGENTS_FALLBACK` descriptor when both share the same `installDir` value. The user-facing install summary SHALL name "Codex" as the target for `.agents/skills/` writes when `.codex/` is present, instead of the generic fallback labeling.

#### Scenario: Codex detection labels the .agents/ install as Codex

- **WHEN** `.codex/` is present and `taskless init` runs
- **THEN** the install summary SHALL identify the `.agents/skills/` writes as belonging to Codex
- **AND** SHALL NOT use the "no tools detected, installing fallback" wording

#### Scenario: Lookup by installDir resolves to Codex over fallback

- **WHEN** the state-based cleanup helper looks up a tool descriptor by `installDir = ".agents"`
- **AND** Codex is registered in the tool array
- **THEN** the lookup SHALL return the Codex descriptor, not `AGENTS_FALLBACK`

#### Scenario: Fallback still resolvable for legacy state without Codex detection

- **WHEN** a previous install state recorded `.agents/` as the target
- **AND** `.codex/` does not exist in the working directory
- **AND** no other tools are detected
- **THEN** the install SHALL proceed using the fallback path
- **AND** files SHALL still be written to `.agents/skills/`

### Requirement: Agents fallback install

`.agents/` is an ordinary selectable tool target, a peer of `.claude/`, `.cursor/`, and `.opencode/`. When `.agents/` is selected, a reference skill stub SHALL be installed to `.agents/skills/<name>/SKILL.md`. The `.agents/` target SHALL NOT receive commands. When no tools are detected, `.agents/` SHALL be the default selected target so a `taskless init` with zero detected tools still produces a usable install.

#### Scenario: .agents stub written when no tools detected

- **WHEN** a user runs `taskless init`
- **AND** no tools are detected in the project root
- **THEN** `.agents/` SHALL be selected by default
- **AND** a reference skill stub SHALL be installed to `.agents/skills/`

#### Scenario: .agents target does not install commands

- **WHEN** the `.agents/skills/` stub is written
- **THEN** no command files SHALL be written to `.agents/`

### Requirement: Detection checks files and directories with stat

Directory detection signals SHALL use `fs.stat()` and verify `isDirectory()`. File detection signals SHALL use `fs.stat()` and verify `isFile()` to avoid false positives on directories. All detection checks SHALL run in parallel.

#### Scenario: Directory signal uses stat

- **WHEN** a directory detection signal is evaluated
- **THEN** `fs.stat()` SHALL be called on the path
- **AND** `isDirectory()` SHALL return true for detection to succeed

#### Scenario: File signal uses stat

- **WHEN** a file detection signal is evaluated
- **THEN** `fs.stat()` SHALL be called on the path
- **AND** `isFile()` SHALL return true for detection to succeed

#### Scenario: Detection runs in parallel

- **WHEN** `detectTools()` is called
- **THEN** all tool detection checks SHALL run concurrently via `Promise.all`

### Requirement: Skills are installed as Agent Skills spec SKILL.md files

The CLI SHALL install skill content using a canonical-store-plus-stub model rather than writing a full copy per detected tool. The full skill content SHALL be written exactly once to the canonical `.taskless/skills/<name>/SKILL.md`. Each selected tool directory SHALL receive its own reference stub as defined by the reference-stub requirement. Skill names SHALL be installed verbatim from the embedded source. No additional namespace prefixing SHALL be applied at install time.

#### Scenario: Canonical skill content matches source

- **WHEN** a skill is installed
- **THEN** the canonical `.taskless/skills/<name>/SKILL.md` content SHALL be identical to the embedded source from `skills/`
- **AND** no frontmatter fields SHALL be modified at install time

#### Scenario: Selected tool directory receives a stub, not a full copy

- **WHEN** the CLI installs the `taskless` skill and any tool directory is selected
- **THEN** that directory's skill location SHALL contain a reference stub
- **AND** SHALL NOT contain a full copy of the canonical skill content

### Requirement: Claude Code commands are placed from embedded source

For Claude Code, the CLI SHALL place a reference command stub at `.claude/commands/tskl/<name>.md`. The stub SHALL delegate to the canonical command at `.taskless/commands/tskl/<name>.md` and SHALL NOT inline the command content.

#### Scenario: Command stub is placed for Claude Code

- **WHEN** the CLI installs for Claude Code
- **THEN** it SHALL write a command stub to `.claude/commands/tskl/<name>.md`
- **AND** the stub SHALL delegate to `.taskless/commands/tskl/<name>.md`

#### Scenario: Command stubs are only placed for tools that support commands

- **WHEN** the CLI installs for a tool directory that does not support commands (`.opencode/`, `.agents/`)
- **THEN** no command file SHALL be written for that directory

### Requirement: Cursor commands are placed from embedded source

For Cursor, the CLI SHALL place a reference command stub at `.cursor/commands/tskl/<name>.md`, mirroring the layout used for Claude Code. The stub SHALL delegate to the canonical command at `.taskless/commands/tskl/<name>.md` and SHALL NOT inline the command content.

#### Scenario: Command stub is placed for Cursor

- **WHEN** the CLI installs for Cursor
- **THEN** it SHALL write a command stub to `.cursor/commands/tskl/<name>.md`
- **AND** the stub SHALL delegate to `.taskless/commands/tskl/<name>.md`

#### Scenario: Cursor receives a skill stub and a command stub

- **WHEN** `.cursor/` is selected and the install plan is applied
- **THEN** a skill stub SHALL be written to `.cursor/skills/`
- **AND** a command stub SHALL be written to `.cursor/commands/tskl/`

### Requirement: Skills are bundled into the CLI at build time

The CLI build SHALL embed all skill file content from `skills/` and all command file content from `commands/tskl/` into the compiled bundle using Vite's `import.meta.glob` with raw file imports. No runtime file reads or network fetches SHALL be used to access skill or command content.

#### Scenario: Embedded skills are available at runtime

- **WHEN** the CLI runs `taskless init`
- **THEN** it SHALL access skill content from the embedded bundle without reading the filesystem or making network requests

#### Scenario: Embedded commands are available at runtime

- **WHEN** the CLI runs `taskless init` for Claude Code
- **THEN** it SHALL access command content from the embedded bundle without reading the filesystem

#### Scenario: Build includes all skills from source directory

- **WHEN** `pnpm build` is run in `packages/cli/`
- **THEN** every `SKILL.md` file under `skills/` SHALL be embedded in the output bundle

#### Scenario: Build includes all commands from source directory

- **WHEN** `pnpm build` is run in `packages/cli/`
- **THEN** every `.md` file under `commands/tskl/` SHALL be embedded in the output bundle

### Requirement: Init respects the global working directory flag

The `init` subcommand SHALL use the resolved working directory from the global `-d` flag (or `process.cwd()` if not specified) as the target directory for tool detection and skill installation.

#### Scenario: Init uses custom directory

- **WHEN** a user runs `taskless init -d /path/to/repo`
- **THEN** tool detection and skill installation SHALL operate on `/path/to/repo`

#### Scenario: Init defaults to current directory

- **WHEN** a user runs `taskless init` without `-d`
- **THEN** tool detection and skill installation SHALL operate on `process.cwd()`

### Requirement: Bare taskless invocation launches the init wizard

The CLI entry point SHALL delegate to `init` when invoked with no positional subcommand AND a TTY is attached. When stdout is NOT a TTY, bare `taskless` SHALL print a non-interactive preamble explaining the context, followed by the agent topic index (instead of attempting the wizard or printing only top-level help).

#### Scenario: Bare taskless in a TTY launches the wizard

- **WHEN** a user runs `taskless` with no subcommand and stdout is a TTY
- **THEN** the CLI SHALL behave as if `taskless init` were invoked

#### Scenario: Bare taskless without a TTY prints preamble + agent topic index

- **WHEN** `taskless` is invoked with no subcommand and stdout is not a TTY
- **THEN** the CLI SHALL print a short preamble noting the non-interactive context (e.g. "For interactive install, run from a terminal. For agent recipes, run `taskless agent` (no args) for the topic index.")
- **AND** SHALL then print the agent topic index (same content as `taskless agent`)
- **AND** SHALL NOT launch the wizard
- **AND** SHALL NOT silently install

### Requirement: Wizard renders an intro banner

The wizard SHALL begin by rendering an ASCII rendition of the Taskless wordmark followed by the CLI version, styled with `chalk` for color output. The banner SHALL downgrade gracefully when colors are disabled (e.g., `NO_COLOR=1` or non-TTY). The exact ASCII art is not fixed by this requirement and MAY be iterated in follow-up changes.

#### Scenario: Wizard prints a banner on start

- **WHEN** the wizard starts
- **THEN** an ASCII banner SHALL be written to stderr before any prompts

#### Scenario: Banner honors NO_COLOR

- **WHEN** `NO_COLOR=1` is set in the environment
- **THEN** the banner SHALL be rendered without ANSI color escapes

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

### Requirement: Wizard explains the auth tradeoff and offers to log in

The wizard SHALL present a short informational screen describing the tradeoff between anonymous and authenticated use: authenticated rules retain conversation history across teammates, enabling rule provenance (answering "why do we have this rule?"). The screen SHALL be followed by a yes/no prompt asking the user whether they want to log in now. If the user accepts, the wizard SHALL invoke the shared interactive login routine (the same routine used by `taskless auth login`) and SHALL block until the login flow completes or is cancelled. If the user declines, the wizard SHALL print a one-line hint that they can run `taskless auth login` later and proceed to the install step. If a valid token is already present, the wizard SHALL skip this step entirely.

#### Scenario: Auth step is shown when not logged in

- **WHEN** the wizard reaches the auth step and no valid token is resolvable
- **THEN** the wizard SHALL display the tradeoff explanation
- **AND** SHALL prompt the user to log in

#### Scenario: Accepting login blocks until completion

- **WHEN** the user accepts the login prompt
- **THEN** the wizard SHALL invoke the shared interactive login routine
- **AND** SHALL NOT advance to the install step until the login routine resolves

#### Scenario: Declining login advances with a hint

- **WHEN** the user declines the login prompt
- **THEN** the wizard SHALL print a hint mentioning `taskless auth login`
- **AND** SHALL advance to the install step

#### Scenario: Auth step is skipped when already logged in

- **WHEN** the wizard reaches the auth step and a valid token already exists for the working directory
- **THEN** the wizard SHALL skip the auth explanation and prompt entirely

### Requirement: Shared interactive login routine

The CLI SHALL expose a single `loginInteractive()` function that performs the device-code login flow and returns once the token is stored or cancelled. Both the `auth login` subcommand and the wizard's auth step SHALL call this function. No duplicate login implementation SHALL exist.

#### Scenario: Auth login uses the shared routine

- **WHEN** a user runs `taskless auth login`
- **THEN** the command handler SHALL call `loginInteractive()`

#### Scenario: Wizard uses the shared routine

- **WHEN** the wizard user accepts the login prompt
- **THEN** the wizard SHALL call `loginInteractive()`

### Requirement: Wizard shows a diff-style summary before writing

Before any filesystem writes, the wizard SHALL display a summary of planned actions grouped by target location. The summary SHALL include:

- Additions: skills that will be newly written to a target
- Removals: skills previously recorded in the install manifest but not selected in the current session
- Unchanged: skills that will be overwritten with identical content (may be collapsed to a count)

If the summary contains any removals, the wizard SHALL require an explicit `confirm()` before proceeding. The confirmation prompt SHALL be itemized per target: it SHALL name each target directory losing content and the count of stubs being removed from it (for example, "Remove Taskless from `.claude/` (2 stubs), `.cursor/` (1 stub)?"). If the summary contains no removals, the wizard MAY proceed without an extra confirm.

#### Scenario: Additions are shown in the summary

- **WHEN** the wizard reaches the summary step and the user has selected a location that was not in the previous install manifest
- **THEN** the summary SHALL list every skill to be added under that location

#### Scenario: Removals trigger an itemized confirm

- **WHEN** the summary contains at least one skill or location to be removed
- **THEN** the wizard SHALL display a confirm prompt before writing
- **AND** the confirm prompt SHALL name each target directory losing content and the count of stubs removed from it
- **AND** declining the confirm SHALL abort without writes

#### Scenario: No-removal summaries skip the extra confirm

- **WHEN** the summary contains only additions and unchanged entries
- **THEN** the wizard MAY proceed directly to writes without an extra confirm

### Requirement: Wizard cancellation aborts without filesystem writes

If the user cancels the wizard at any step (Ctrl-C, Esc, or equivalent clack cancel signal) before the install step completes, the CLI SHALL NOT write any skill files, command files, or manifest updates. The CLI SHALL exit with a non-zero exit code and print a short message indicating how to resume (`taskless init`).

#### Scenario: Cancel at locations step

- **WHEN** the user cancels the wizard during the locations step
- **THEN** no files SHALL be written
- **AND** the CLI SHALL exit non-zero

#### Scenario: Cancel at auth step

- **WHEN** the user cancels the wizard during the auth step
- **THEN** no skill files or manifest updates SHALL be written
- **AND** the CLI SHALL exit non-zero

#### Scenario: Cancel at summary confirm

- **WHEN** the user declines the summary confirm
- **THEN** no files SHALL be written
- **AND** the CLI SHALL exit non-zero

### Requirement: Install manifest records what was installed per target

The install manifest in `.taskless/taskless.json` continues to record what was written per target. Each target entry SHALL additionally record a `mode` field (`canonical` or `reference`) as defined by the per-target install mode requirement. The `.taskless` target records the canonical store; tool-directory targets record the stubs written for that directory.

#### Scenario: Manifest records the canonical store and reference stubs with modes

- **WHEN** init writes the canonical store and stubs for `.claude/` and `.agents/`
- **THEN** the manifest's `install.targets[".taskless"]` SHALL have `mode: "canonical"`
- **AND** `install.targets[".claude"]` and `install.targets[".agents"]` SHALL each have `mode: "reference"`

### Requirement: Re-install computes a diff against the previous manifest

A re-install SHALL compute a diff against the previous manifest. With v0.7.0 the diff for a v0.6 user shows 10 skill removals + 6 command removals + 1 skill addition + 1 command addition per detected target. Removals SHALL require user confirmation per the existing requirement.

#### Scenario: Upgrade from v0.6 shows removals in summary

- **WHEN** a user with v0.6 installed runs `taskless init` after upgrading to v0.7.0
- **THEN** the wizard summary SHALL list the 10 obsolete skills and 6 obsolete commands as removals
- **AND** SHALL require user confirmation before deleting

### Requirement: Init prints a post-install onboarding trailer

After a successful install (both wizard and `--no-interactive` paths), `taskless init` SHALL print a single one-line trailer pointing the user at the new onboarding flow. The trailer SHALL be printed AFTER the install summary (the lines that report what was written and any obsolete files removed) and SHALL be the final line of output before the process exits. The trailer SHALL NOT be gated on the value of `install.onboarded` in the manifest — it is informational, printed every successful install. The trailer's wording SHALL adapt to the install plan: when at least one installed target received the `tskl` slash command (Claude Code or Cursor), the trailer SHALL mention `/tskl onboard`, the Taskless skill, AND `taskless onboard` (since command-receiving tools also get the skill, both AI-tool entry points are surfaced); when no installed target received commands (OpenCode, Codex, or the `.agents/` fallback), the trailer SHALL mention only the Taskless skill and `taskless onboard`, and SHALL NOT mention `/tskl onboard`. The trailer SHALL be suppressed when `taskless init` exits non-zero (cancelled wizard, install failure, etc.) or when the install was a no-op (no targets selected, no files to write).

#### Scenario: Wizard install with commands mentions slash command, skill, and CLI

- **WHEN** a user runs `taskless init` in an interactive terminal and the wizard completes successfully
- **AND** at least one selected target received the `tskl` slash command (Claude Code or Cursor)
- **THEN** the final line of output SHALL be a single-line trailer that mentions `/tskl onboard`, the Taskless skill, AND `taskless onboard`

#### Scenario: Wizard install without commands mentions skill and CLI only

- **WHEN** a user runs `taskless init` in an interactive terminal and the wizard completes successfully
- **AND** no selected target received commands (e.g. only OpenCode and/or Codex were chosen)
- **THEN** the final line of output SHALL be a single-line trailer instructing the user to invoke the Taskless skill via natural language and mentioning `taskless onboard` as a terminal fallback
- **AND** the trailer SHALL NOT mention `/tskl onboard`

#### Scenario: Non-interactive install with commands mentions slash command, skill, and CLI

- **WHEN** a user runs `taskless init --no-interactive` against a project where Claude Code or Cursor is detected
- **THEN** the final line of output SHALL mention `/tskl onboard`, the Taskless skill, AND `taskless onboard`

#### Scenario: Non-interactive install with no commands mentions skill and CLI only

- **WHEN** a user runs `taskless init --no-interactive` against a project where no command-receiving tool is detected (the install uses the `.agents/` fallback or only OpenCode/Codex)
- **THEN** the final line of output SHALL mention the Taskless skill and `taskless onboard`
- **AND** SHALL NOT mention `/tskl onboard`

#### Scenario: Cancelled wizard suppresses the trailer

- **WHEN** a user cancels the wizard (Ctrl-C or equivalent)
- **THEN** the trailer SHALL NOT be printed

#### Scenario: Failed install suppresses the trailer

- **WHEN** `taskless init` exits non-zero due to an install failure
- **THEN** the trailer SHALL NOT be printed

#### Scenario: Trailer is printed regardless of onboarded state

- **WHEN** a user re-runs `taskless init` and `install.onboarded` is already `true`
- **THEN** the trailer SHALL still be printed
- **AND** the trailer wording SHALL still adapt to whether commands were installed by the current run

### Requirement: Skill and command content is installed once to the canonical .taskless store

The CLI SHALL write skill and command content exactly once per install, to a canonical store inside Taskless's owned `.taskless/` namespace: skill content to `.taskless/skills/<name>/SKILL.md` and command content to `.taskless/commands/tskl/<name>.md`. The canonical write SHALL occur on every install that contains at least one skill or command, regardless of which tools are selected.

The `.taskless/` canonical store SHALL NOT be a tool install target: no tool's detection, install destination, or cleanup logic SHALL point at `.taskless/skills/` or `.taskless/commands/`. This guarantees that no install target can ever delete the canonical content.

#### Scenario: Canonical content is written once

- **WHEN** `taskless init` runs and the install plan contains the `taskless` skill and `tskl` command
- **THEN** the CLI SHALL write the full skill content to `.taskless/skills/taskless/SKILL.md`
- **AND** SHALL write the full command content to `.taskless/commands/tskl/tskl.md`

#### Scenario: Canonical write happens regardless of selected tools

- **WHEN** `taskless init` runs with any combination of tool directories selected, including none
- **THEN** the canonical `.taskless/` store SHALL be written

#### Scenario: No tool target points at the canonical store

- **WHEN** the install plan is constructed and applied
- **THEN** no tool target's install or cleanup operation SHALL write to or delete `.taskless/skills/` or `.taskless/commands/`

### Requirement: Selected tool directories receive reference stubs

For every selected tool directory, the CLI SHALL write a **reference stub** rather than a full copy. Each selected directory receives its own stub — `.claude/`, `.cursor/`, `.opencode/`, and `.agents/` are peer targets, and no directory is special-cased or routed onto another. A stub SHALL be an ordinary file (never a symlink). A skill stub SHALL contain valid YAML frontmatter with `name` and `description` copied from the canonical skill so the tool can discover and trigger it, plus a `metadata` block carrying `type: shim` (which marks the file as a reference stub) and the canonical `version` (carried for reference and kept in lockstep with the canonical content). Its body SHALL instruct the agent to read the canonical file (`.taskless/skills/<name>/SKILL.md` for skills, `.taskless/commands/tskl/<name>.md` for commands) and follow it, and SHALL NOT duplicate the canonical content inline. Every stub SHALL point directly at a canonical file, never at another stub.

The CLI SHALL NOT create symlinks for any tool, for skills or commands.

The per-directory stub layout is:

- `.claude/skills/<name>/SKILL.md` and `.claude/commands/tskl/<name>.md` — Claude Code.
- `.cursor/skills/<name>/SKILL.md` and `.cursor/commands/tskl/<name>.md` — Cursor.
- `.opencode/skills/<name>/SKILL.md` — OpenCode (no command stub).
- `.agents/skills/<name>/SKILL.md` — generic Agent Skills location, including Codex (no command stub).

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
- **THEN** no skill or command file or directory written by the CLI SHALL be a symlink

### Requirement: Install manifest records a per-target install mode

Each target entry in `.taskless/taskless.json` install state SHALL record a `mode` field with one of two values: `canonical` (the `.taskless/` store, holding full content) or `reference` (a tool directory holding stubs). The manifest SHALL remain backward-compatible: when reading a prior manifest with no `mode` field, the CLI SHALL treat existing entries as `canonical`.

#### Scenario: Manifest records canonical and reference modes

- **WHEN** `taskless init` writes the canonical store plus tool stubs
- **THEN** the `.taskless` target entry SHALL have `mode: "canonical"`
- **AND** each selected tool directory entry SHALL have `mode: "reference"`

#### Scenario: Legacy manifest without mode is treated as canonical

- **WHEN** the CLI reads a prior manifest whose target entries omit `mode`
- **THEN** it SHALL treat each such entry as `mode: "canonical"` without error

### Requirement: Update rewrites canonical content and preserves reference stubs

`taskless update` SHALL rewrite the canonical `.taskless/skills/` and `.taskless/commands/` content from the embedded bundle. For `reference`-mode targets, update SHALL create a stub only if it is missing, and SHALL NOT overwrite an existing stub with full canonical content. Update SHALL re-generate a stub in place only when its frontmatter `name`, `description`, or `metadata.version` has drifted from the canonical content; the stub's delegating body SHALL be preserved.

Update SHALL NOT delete or `rm -rf` the canonical `.taskless/` store, nor any directory that another target sources content from. Removal logic SHALL operate only on entries recorded in the prior manifest and SHALL respect each entry's `mode`.

#### Scenario: Update refreshes canonical content

- **WHEN** `taskless update` runs against an install with a newer bundled skill version
- **THEN** `.taskless/skills/taskless/SKILL.md` SHALL be rewritten with the new content

#### Scenario: Update does not clobber a reference stub

- **WHEN** `taskless update` runs and `.claude/skills/taskless/SKILL.md` is an existing reference stub
- **THEN** update SHALL NOT replace it with full canonical content
- **AND** the stub SHALL continue to delegate to `.taskless/skills/taskless/SKILL.md`

#### Scenario: Update never destroys the canonical store

- **WHEN** `taskless update` processes its targets
- **THEN** it SHALL NOT delete `.taskless/skills/` or `.taskless/commands/` as part of cleaning up any target
- **AND** the canonical content SHALL remain readable throughout the update

### Requirement: Existing installs converge to the canonical-plus-stub layout

When a prior install left a full skill or command copy in a tool directory, or left a tool entry that exists on disk as a symlink, `taskless init`/`update` SHALL converge the repository onto the canonical-plus-stub layout with no separate migration step. `applyInstallPlan` SHALL seed the canonical `.taskless/` store and, for each `reference` target, SHALL rewrite the file unless it is already a current, non-drifted shim stub (a file carrying the `metadata.type: shim` marker with matching `name`, `description`, and `metadata.version`). A full copy lacks the marker and a symlink is detected by `lstat`, so each is rewritten as a real stub. Convergence SHALL be reported in the install summary.

#### Scenario: A full per-tool copy is converted to a stub

- **WHEN** a user whose prior install wrote a full `.cursor/skills/taskless/SKILL.md` runs `taskless update`
- **THEN** `.cursor/skills/taskless/SKILL.md` SHALL be replaced with a reference stub delegating to the canonical store
- **AND** the canonical `.taskless/skills/taskless/SKILL.md` SHALL be present

#### Scenario: A symlinked tool entry is replaced with a real stub

- **WHEN** `taskless update` finds `.claude/skills/taskless` recorded as a target but present on disk as a symlink
- **THEN** update SHALL replace the symlink with a real reference stub file
- **AND** SHALL NOT write through the symlink into another directory

### Requirement: A reference stub says how to restore a missing canonical file

A reference stub's body SHALL state what to do when the canonical file it points at is not present, naming a command that restores it. A stub that only delegates leaves a reader who follows it at a dead end, and the two states that produce a missing canonical file (an install whose untracked files never reached this working directory, and a project that ignores the canonical store) are both reached without anyone doing anything wrong.

Skill stubs and command stubs SHALL carry the same instruction.

The command named SHALL be the one that runs the build which wrote the stub, resolved the same way canonical content resolves it. A stub emitted by a development or nightly build SHALL NOT direct the reader to the released package.

The command named SHALL install without an interactive terminal, since the reader of a stub is typically an agent in a non-interactive context.

Stub content SHALL carry nothing that varies per release, so that adding this instruction changes the footprint outside the canonical store exactly once.

A stub already on disk whose body predates this instruction SHALL be rewritten once by the next install, rather than waiting for its frontmatter to change. Detection of such a stub SHALL NOT depend on the build that wrote it, so that builds with different invocations do not rewrite one another's stubs.

#### Scenario: Stub names the command that restores a missing canonical file

- **WHEN** the CLI writes a skill stub or a command stub
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
