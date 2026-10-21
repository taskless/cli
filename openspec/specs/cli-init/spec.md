# CLI Init

## Purpose

The `taskless init` subcommand: how it detects the AI tools present in a repository and installs the Taskless skills and commands for them.

## Requirements

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

The skill source SHALL name the CLI through the `%(TASKLESS_CLI)s` placeholder, the same token the recipes use, and SHALL NOT contain the literal `npx @taskless/cli` in its body. The canonical write renders the placeholder to this build's launcher, `./.taskless/bin/cli.mjs` for a release build and `./.taskless/bin/cli-nightly.mjs` for a nightly, so the rendered skill does not change between versions of one package. A `self` build, which installs no launcher, renders its path-form invocation. Rendering is an exact-token substitution, not a search for the literal invocation in prose: a literal is whitespace-sensitive, so a wrapped line or a doubled space silently escaped the rewrite and reached a nightly install naming the release package.

A reference stub's recovery command is not rendered to the launcher. It SHALL keep the npx form it has today (unpinned `npx @taskless/cli init` for a release build), since it exists for when the canonical store, and the launcher with it, is missing.

#### Scenario: Canonical skill content matches source

- **WHEN** a skill is installed
- **THEN** the canonical `.taskless/skills/<name>/SKILL.md` content SHALL be identical to the embedded source from `skills/` with every `%(TASKLESS_CLI)s` rendered to the build's launcher, which for a release build is `./.taskless/bin/cli.mjs`
- **AND** no frontmatter fields SHALL be modified at install time

#### Scenario: The rendered skill does not move with the version

- **WHEN** the release's `init` runs at `0.13.0` and then at `0.13.1`, and the skill source did not change between them
- **THEN** the canonical `SKILL.md` SHALL be byte-identical after both

#### Scenario: A stub's recovery command keeps the npx form

- **WHEN** the release's `init` at `0.13.0` writes a reference stub
- **THEN** the stub's recovery command SHALL be `npx @taskless/cli init`
- **AND** SHALL NOT name `./.taskless/bin/cli.mjs`

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

### Requirement: Init respects the global working directory flag

The `init` subcommand SHALL use the resolved working directory from the global `-d` flag (or `process.cwd()` if not specified) as the target directory for tool detection and skill installation.

#### Scenario: Init uses custom directory

- **WHEN** a user runs `taskless init -d /path/to/repo`
- **THEN** tool detection and skill installation SHALL operate on `/path/to/repo`

#### Scenario: Init defaults to current directory

- **WHEN** a user runs `taskless init` without `-d`
- **THEN** tool detection and skill installation SHALL operate on `process.cwd()`

### Requirement: Bare taskless invocation launches the init wizard

The CLI entry point SHALL launch the interactive install wizard when invoked with no positional subcommand AND both stdout and stdin are TTYs AND `CI` is not `true` or `1`. The `CI` check outranks the TTYs: some automated environments allocate a pseudo-terminal on both streams, and a wizard launched there waits for input nobody will give. When any of those conditions fails, bare `taskless` SHALL print a non-interactive preamble explaining the context, followed by the agent topic index (instead of attempting the wizard or printing only top-level help).

#### Scenario: Bare taskless in a TTY launches the wizard

- **WHEN** a user runs `taskless` with no subcommand and stdout is a TTY
- **THEN** the CLI SHALL launch the interactive wizard

#### Scenario: Bare taskless under CI does not launch the wizard

- **WHEN** `taskless` is invoked with no subcommand, both streams report a TTY, and `CI` is `true` or `1`
- **THEN** the CLI SHALL NOT launch the wizard
- **AND** SHALL take the non-TTY path below

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

The wizard's location step SHALL be presented as a tool-selection step: "which tools do you want to enable Taskless for?". It SHALL offer one row per directory: `Claude Code` (`.claude/`), `Cursor` (`.cursor/`), `OpenCode` (`.opencode/`), and a row for `.agents/`. A user who arrived from a harness that reads `.agents/` SHALL NOT have to know that before recognising their harness in the list, so the `.agents/` row SHALL be labelled with harness names: the detected harnesses whose own documentation says they read `.agents/skills` (OpenCode, Codex, Gemini CLI, Crush), in catalog order, followed by `and other .agents harnesses`, for example `OpenCode, Codex, and other .agents harnesses (.agents/)`. The row SHALL name only detected harnesses: an undetected harness SHALL NOT be named, since the harnesses that read `.agents/skills` outnumber what fits on one row. When none of them is detected, the row SHALL be labelled `Agent Skills (.agents/)`.

Every list of directories derived from the catalog SHALL name each directory at most once, however many detected tools install into it. The pre-checked set SHALL be the union of (a) every directory recorded as a target in the install manifest (`install.targets`) that matches an offered row, and (b) every detected tool's install directory, deduplicated by directory. When the manifest records no targets AND no tools are detected, `.agents/` SHALL be pre-checked as the first-run default. The canonical `.taskless/` store SHALL NOT appear as a selectable entry and SHALL NOT be pre-checked — it is always written and is never a manifest tool-directory target.

Each offered entry SHALL carry an origin hint: `installed` when the entry's directory is recorded in the install manifest; otherwise `detected` when a detected tool installs into the entry's directory; otherwise `not detected`. A harness named on the `.agents/` row only because it reads `.agents/skills`, such as OpenCode, whose own directory is `.opencode/`, SHALL NOT make that row `detected` or pre-check it, since installing into both directories would give that harness the skill twice. The `installed` hint SHALL take precedence over `detected` when both apply.

Unchecking a pre-checked, manifest-recorded entry SHALL cause the resulting install plan to omit that target, so the existing manifest-diff removal path removes Taskless's reference stubs from that directory. The at-least-one-tool selection rule is unchanged: the wizard SHALL require at least one checked entry.

Each selected directory SHALL produce exactly one `reference` stub target; the resulting install plan always contains the single `taskless` skill and no command. The `.agents/` target SHALL be reported in the install summary as `Agent Skills`. The function that maps detected tools and manifest targets to multiselect choices SHALL be pure — it SHALL receive both the detected tools and the manifest target list as arguments and SHALL perform no filesystem access — so the mapping is unit-testable.

#### Scenario: Codex is named in the tool list

- **WHEN** the wizard renders the tool-selection multiselect with Codex detected
- **THEN** the `.agents/` row's label SHALL name `Codex`
- **AND** exactly one entry SHALL be offered for `.agents/`

#### Scenario: Undetected .agents harnesses are not named

- **WHEN** the wizard renders the tool-selection multiselect with no `.agents` harness detected
- **THEN** the `.agents/` row SHALL be labelled `Agent Skills (.agents/)`
- **AND** the label SHALL NOT name OpenCode, Codex, Gemini CLI, or Crush

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

After a successful install (both wizard and `--no-interactive` paths), `taskless init` SHALL print a trailer pointing the user at the onboarding flow. The trailer SHALL be exactly two lines: one line of explanation, then a prompt the user can paste into their AI tool, `Onboard this project with Taskless`, alone on its own line. The prompt line SHALL carry no quotes, bullets, or prefix characters, so that selecting the whole line copies exactly the prompt. When colour is enabled the prompt line SHALL be coloured so it reads as the thing to copy; when it is disabled the same text SHALL print plain. Colour SHALL come from the CLI's shared colour setup, which disables it under `NO_COLOR` or when neither stdout nor stderr is a terminal. The trailer SHALL be printed AFTER the install summary (the lines that report what was written and any obsolete files removed) and SHALL end the output before the process exits, its prompt line being the final line. Where another requirement says the onboarding trailer is the final line, it means this: the trailer ends the output, with its prompt line last. The trailer SHALL NOT be gated on the value of `install.onboarded` in the manifest — it is informational, printed every successful install. The trailer's wording SHALL be the same for every install plan: every installed target receives the Taskless skill, so the explanation line SHALL name the Taskless skill and the prompt SHALL ask the AI tool to onboard with Taskless, and SHALL NOT mention `/tskl onboard` or a terminal `taskless onboard` command. The trailer SHALL be suppressed when `taskless init` exits non-zero (cancelled wizard, install failure, etc.) or when the install was a no-op (no targets selected, no files to write).

#### Scenario: Wizard install points at the skill only

- **WHEN** a user runs `taskless init` in an interactive terminal and the wizard completes successfully
- **THEN** the output SHALL end with the trailer: an explanation line naming the Taskless skill, then `Onboard this project with Taskless` as the final line
- **AND** the trailer SHALL NOT mention `/tskl onboard` or `taskless onboard`

#### Scenario: Non-interactive install points at the skill only

- **WHEN** a user runs `taskless init --no-interactive`, whatever tools are detected
- **THEN** the output SHALL end with the same skill-only trailer, its prompt as the final line
- **AND** SHALL NOT mention `/tskl onboard` or `taskless onboard`

#### Scenario: The prompt line is coloured on a colour terminal

- **WHEN** the trailer is printed to a colour terminal
- **THEN** the prompt line SHALL be coloured and its visible text SHALL be exactly `Onboard this project with Taskless`

#### Scenario: The prompt line prints plain without colour

- **WHEN** the trailer is printed under `NO_COLOR`, or when neither stdout nor stderr is a terminal
- **THEN** the prompt line SHALL be exactly `Onboard this project with Taskless`, with no escape sequences, quotes, bullets, or prefix

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

### Requirement: Init reports what an upgrade changed and what follows

`taskless init` SHALL tell its caller what an install changed beyond the files it wrote, because its caller is usually an agent that `check` sent there and that must decide what to do next.

On the human path, when the run changed anything (a migration ran, any target had a skill or command written or removed, or the recorded `install.cliVersion` moved), the CLI SHALL print an upgrade trailer directly AFTER the install summary and BEFORE any reload notice and the onboarding trailer. It prints first among the trailing notices because a reload, and anything the onboarding trailer proposes, come after the upgrade is understood. The upgrade trailer SHALL:

- name each directory that now holds changed files (every target directory with a write or removal, and `.taskless/` when a migration ran or the recorded version moved), and state that those files belong in the next commit;
- when the recorded `install.cliVersion` moved (a previous version was recorded and differs from the one this run recorded), state the transition and that `taskless update` reports what the upgrade means for existing rules;
- be omitted entirely when nothing changed. A no-op re-install has nothing to commit and nothing to reconcile.

The onboarding trailer SHALL remain the final line of output.

Under `--json`, the envelope SHALL carry the same facts as fields rather than prose:

- `cliVersion`: `{ previous: string | null, installed: string }`, where `previous` is the `install.cliVersion` read before this run and `null` when none was recorded;
- `targets`: one entry per install target, `{ dir, mode, writtenSkills, writtenCommands, removedSkills, removedCommands }`, with the four lists holding names, so the per-target summary that the human path prints is on the envelope instead of on stderr;
- `changed`: `true` when a migration ran, any target list above is non-empty, or the recorded version moved. A version move rewrites `install.cliVersion` in `.taskless/taskless.json`, a tracked file, so it is a change even when every skill byte already matched.

The `migrated` field is unchanged: present with the migration report when a migration ran, absent otherwise.

#### Scenario: An upgrade prints the trailer with both parts

- **WHEN** `taskless init` runs against a project whose recorded `install.cliVersion` differs from the running CLI, and the run writes at least one stub
- **THEN** stdout SHALL contain an upgrade trailer naming each directory that changed and saying those files belong in the next commit
- **AND** the trailer SHALL name the previous and installed versions and point at `taskless update`
- **AND** the trailer SHALL appear before any reload notice
- **AND** the onboarding trailer SHALL still be the final line

#### Scenario: A change without a version move omits the update pointer

- **WHEN** the run writes or removes files but the recorded `install.cliVersion` is the running version
- **THEN** the upgrade trailer SHALL name the changed directories and the commit obligation
- **AND** SHALL NOT mention `taskless update`

#### Scenario: A no-op re-install prints no upgrade trailer

- **WHEN** `taskless init` runs against a project that is already at the current scaffold version and whose every target reports up to date
- **THEN** stdout SHALL NOT contain the upgrade trailer

#### Scenario: The JSON envelope carries the version, targets, and changed flag

- **WHEN** `taskless init --json` runs
- **THEN** the envelope SHALL contain `cliVersion.previous` (a string or `null`), `cliVersion.installed`, a `targets` array with one entry per install target, and a boolean `changed`
- **AND** `changed` SHALL be `true` exactly when `migrated` is present, any target's written or removed list is non-empty, or `cliVersion.previous` is non-null and differs from `cliVersion.installed`

### Requirement: Wizard does not offer to log in

The wizard SHALL NOT prompt the user to log in, and SHALL NOT display an authentication explanation, at any step. It SHALL proceed from the tool-selection step directly to the install summary whether or not a token is available. Setup requires no account: authoring and running local rules needs none, and `taskless auth login` remains available, as do the "run `taskless auth login`" remedies on commands that require authentication.

#### Scenario: Wizard advances from tools to summary without a login prompt

- **WHEN** the wizard completes the tool-selection step and no valid token is resolvable
- **THEN** the wizard SHALL NOT display an authentication note or a login prompt
- **AND** SHALL advance to the install summary

#### Scenario: Wizard does not start the login flow

- **WHEN** the wizard runs to completion
- **THEN** it SHALL NOT call `loginInteractive()`

### Requirement: A single interactive login routine serves auth login

The CLI SHALL expose a single `loginInteractive()` function that performs the device-code login flow and returns once the token is stored or cancelled. The `auth login` subcommand SHALL call this function. No duplicate login implementation SHALL exist.

#### Scenario: Auth login uses the shared routine

- **WHEN** a user runs `taskless auth login`
- **THEN** the command handler SHALL call `loginInteractive()`

### Requirement: Cancelling the wizard writes nothing

If the user cancels the wizard at any step (Ctrl-C, Esc, or equivalent clack cancel signal) before the install step completes, the CLI SHALL NOT write any skill files, command files, or manifest updates. The CLI SHALL exit with a non-zero exit code and print a short message indicating how to resume (`taskless init`).

#### Scenario: Cancel at locations step

- **WHEN** the user cancels the wizard during the locations step
- **THEN** no files SHALL be written
- **AND** the CLI SHALL exit non-zero

#### Scenario: Cancel at summary confirm

- **WHEN** the user declines the summary confirm
- **THEN** no files SHALL be written
- **AND** the CLI SHALL exit non-zero

### Requirement: Init names a package.json pin older than the running CLI

After a successful install, `taskless init` SHALL read `package.json` in the working directory, and the `package.json` of every workspace package the working directory declares, and report every pin of `@taskless/cli` or `@taskless/cli-nightly` that would run a CLI older than the running one.

Workspace packages are declared by the `packages` list of `pnpm-workspace.yaml` and by the `workspaces` field of the root `package.json`, as an array or as `{ packages }`; both sources SHALL be read. A pattern SHALL name each directory it matches that holds a `package.json`. A pattern prefixed `!` SHALL remove the directories it matches. A pattern that is absolute or contains a `..` segment SHALL be skipped. Expansion SHALL NOT descend into `node_modules` or `.git`, and SHALL stop after a fixed number of manifests. The root SHALL be read once even when a pattern names it. An absent or malformed workspace declaration SHALL declare nothing, and a malformed root `package.json` SHALL NOT stop `pnpm-workspace.yaml` from being read.

A pin is:

- an entry in `dependencies`, `devDependencies`, or `optionalDependencies`; or
- a script in `scripts` that spells out `@taskless/cli@<spec>` or `@taskless/cli-nightly@<spec>`, where the name is not the tail of a longer name and the spec ends at whitespace, a quote, or shell punctuation (`;&|()<>,:`). A pin repeated within one script SHALL be reported once.

A dependency pin SHALL be reported when either holds:

- the version installed for that package is older than the running version, because that, and the lockfile it came from, is what runs. It SHALL be read from `node_modules/<name>/package.json` in the directory holding the pin, then in each parent up to the working directory, the first found winning, as Node resolves it: a workspace package's own link under pnpm, the hoisted root copy under npm or yarn; or
- its spec is bounded and cannot reach the running version.

A script pin SHALL be reported when its spec is bounded and cannot reach the running version.

A bounded spec is an exact version (optionally prefixed `=` or `v`, with optional whitespace after the operator, prerelease, and build metadata), or a `^` or `~` range. An exact version, and an installed version, SHALL be compared with semver precedence, so a prerelease sorts before its release and two prereleases of one base compare by their prerelease text, which orders nightlies by build time. A range SHALL be compared by its exclusive ceiling on the numeric core, with caret ranges holding the left-most non-zero part as npm does. A spec the CLI cannot bound (`latest`, `*`, a comparator range, `workspace:`, a URL or git spec) SHALL NOT be reported on its own. An absent or unparseable `package.json`, or an unreadable installed manifest, SHALL produce no report from that source and SHALL NOT fail the install.

Pins SHALL be reported root first, then by workspace manifest path, each manifest's in file order: dependency fields, then scripts.

The install SHALL NOT modify any `package.json`. The report SHALL offer the bump rather than claim it.

On the human path (batch and wizard), when at least one pin is reported, the CLI SHALL print a notice naming, for each pin, its manifest path relative to the working directory, its location in that manifest (the dependency field, or `scripts.<name>`), package, spec, installed version when known, and the package and version to move it to. The target SHALL be the running version on the package that publishes it: `@taskless/cli-nightly` when the running version carries a prerelease, `@taskless/cli` otherwise, with the switch named when the pin is on the other package. The notice SHALL print whether or not the run changed anything. On the batch path it SHALL print after the upgrade trailer, and the onboarding trailer SHALL remain the final line.

When the same run migrated an existing `.taskless/` (the migration's `from` is above `0`), the notice SHALL NOT hedge. It SHALL name the schema versions the run moved between, state that a CLI predating the new schema refuses the project with `SCAFFOLD_VERSION_MISMATCH` so CI running the pins will break on the push carrying the migrated files, and say the bump belongs in the same commit as `.taskless/`. A migration from `0` is how a fresh install creates `.taskless/`; it SHALL NOT be described as an upgrade, and like a run with no migration the notice SHALL describe the failure as likely, not certain.

Under `--json`, the envelope SHALL carry `pinnedCli`: an array of `{ manifest, location, name, spec, installed }`, where `manifest` is the `/`-separated path of the `package.json` holding the pin relative to the working directory, `installed` is the installed version or `null`, present on every successful run and empty when nothing is stale.

#### Scenario: A stale dependency and script pin are named and left alone

- **WHEN** `taskless init` runs at version `V` in a project whose `package.json` has `devDependencies["@taskless/cli"]` set to a version below `V`, and a script running `npx @taskless/cli@<older>`
- **THEN** stdout SHALL name both pins with their location and spec, and the target `@taskless/cli@V`
- **AND** `package.json` SHALL be byte-identical afterwards
- **AND** the notice SHALL appear after the upgrade trailer, with the onboarding trailer still the final line

#### Scenario: An installed build older than the running CLI is stale even when its range admits the running version

- **WHEN** `package.json` pins `@taskless/cli` at `^0.11.0`, `node_modules/@taskless/cli` is `0.11.0`, and the running CLI is `0.11.2`
- **THEN** the pin SHALL be reported with `installed` set to `0.11.0`

#### Scenario: A pre-1.0 caret range that cannot reach the running version is stale

- **WHEN** `package.json` pins `@taskless/cli` at `^0.10.2`, nothing is installed, and the running CLI is `0.11.2`
- **THEN** the pin SHALL be reported

#### Scenario: An older nightly of the same base is stale

- **WHEN** `package.json` pins `@taskless/cli-nightly` at `0.12.0-20260901000000xaaaaaaa` and the running CLI is `0.12.0-20261005000000xbbbbbbb` or `0.12.0`
- **THEN** the pin SHALL be reported

#### Scenario: A nightly pin moves to the release package when a release is running

- **WHEN** a stale pin names `@taskless/cli-nightly` and the running CLI is a release `V`
- **THEN** the notice SHALL give `@taskless/cli@V` as the target and name the package switch

#### Scenario: A floating or current pin is not reported

- **WHEN** nothing older than the running version is installed, and `package.json` pins `@taskless/cli` at `latest`, `*`, `>=0.10.0`, `workspace:*`, or a range that admits the running version, or a script runs `@taskless/cli@latest`
- **THEN** no pin SHALL be reported

#### Scenario: A migration of an existing scaffold makes the breakage definite

- **WHEN** `taskless init` migrates an existing `.taskless/` from schema version `M` above `0` to `N` in a project with a stale pin
- **THEN** the notice SHALL name schema versions `M` and `N` and `SCAFFOLD_VERSION_MISMATCH`
- **AND** SHALL state that CI running the pins will break, and that the bump belongs in the same commit as `.taskless/`
- **AND** SHALL NOT describe the failure as merely likely

#### Scenario: A fresh install is not called an upgrade

- **WHEN** `taskless init` creates `.taskless/` in a project with a stale pin
- **THEN** the notice SHALL describe the failure as likely
- **AND** SHALL NOT mention `SCAFFOLD_VERSION_MISMATCH` or describe the run as an upgrade

#### Scenario: A stale pin is named on a re-install that changed nothing

- **WHEN** `taskless init` runs against a project that is already current and whose `package.json` holds a stale pin
- **THEN** stdout SHALL NOT contain the upgrade trailer
- **AND** stdout SHALL name the stale pin

#### Scenario: The JSON envelope carries the pins

- **WHEN** `taskless init --json` runs
- **THEN** the envelope SHALL contain `pinnedCli`, an array with one `{ manifest, location, name, spec, installed }` entry per stale pin
- **AND** `pinnedCli` SHALL be an empty array when there is no `package.json` or nothing in it is stale

#### Scenario: A pin in a declared workspace package is named with its manifest

- **WHEN** `pnpm-workspace.yaml` declares `packages/*`, or the root `package.json` declares `workspaces` as `["packages/*"]` or `{ "packages": ["packages/*"] }`, and `packages/app/package.json` pins `@taskless/cli` at a version below the running one
- **THEN** the pin SHALL be reported with `manifest` set to `packages/app/package.json`
- **AND** the notice line SHALL name `packages/app/package.json` and the field

#### Scenario: A workspace package is judged by the version it runs

- **WHEN** `packages/linked/package.json` and `packages/hoisted/package.json` both pin `@taskless/cli` at `^0.11.0`, `packages/linked/node_modules/@taskless/cli` is `0.11.0`, only the root `node_modules/@taskless/cli` exists for `packages/hoisted` at `0.11.1`, and the running CLI is `0.11.2`
- **THEN** `packages/linked/package.json` SHALL be reported with `installed` `0.11.0`
- **AND** `packages/hoisted/package.json` SHALL be reported with `installed` `0.11.1`

#### Scenario: Workspace expansion stays inside the project

- **WHEN** a workspace pattern is negated, is absolute, climbs out with `..`, or is `**` over a tree that contains `node_modules`
- **THEN** a directory the negation matches SHALL NOT be reported
- **AND** nothing outside the working directory, and no `package.json` under `node_modules`, SHALL be read as a workspace package

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

### Requirement: Init names a CI or hook pin older than the running CLI

Alongside the `package.json` pins it already reports, `taskless init` SHALL read the project's CI and git-hook configuration files and report every pin of `@taskless/cli` or `@taskless/cli-nightly` in them that would run a CLI older than the running one. Every build pins its own version, so the invocation the `ci` and `hooks` recipes write names that version, and an upgrade leaves it behind.

The files read SHALL be the ones `detect` recognizes as CI and commit-time configuration at the project root: `.github/workflows/*.yml` and `*.yaml`, `.gitlab-ci.yml`, `.circleci/config.yml`, `Jenkinsfile`, `azure-pipelines.yml` and `.yaml`, `bitbucket-pipelines.yml`, `.drone.yml`, `.travis.yml`, the files directly in `.buildkite/` and `.husky/`, the lefthook, pre-commit, simple-git-hooks, and lint-staged config files. They SHALL be read as text with the script-pin grammar, a pin repeated in one file SHALL be reported once at its first line, and only a bounded spec SHALL be judged, as for a script.

Each pin SHALL be reported through the same notice and the same `pinnedCli` envelope entry as a `package.json` pin, with `manifest` the file's root-relative `/`-separated path, `location` `line <n>`, and `installed` `null`, after every `package.json` pin, ordered by path. The notice SHALL introduce its list without naming `package.json` alone. The install SHALL NOT modify any of these files.

#### Scenario: A stale workflow pin is named by file and line

- **WHEN** `.github/workflows/taskless.yml` runs `npx @taskless/cli@0.11.0 check` on line 4 and the running CLI is `0.12.0`
- **THEN** `pinnedCli` SHALL contain `{ "manifest": ".github/workflows/taskless.yml", "location": "line 4", "name": "@taskless/cli", "spec": "0.11.0", "installed": null }`
- **AND** the notice SHALL name `.github/workflows/taskless.yml line 4` and the target `@taskless/cli@0.12.0`
- **AND** the workflow file SHALL be byte-identical afterwards

#### Scenario: Hook files are read

- **WHEN** `.husky/pre-commit` or `lefthook.yml` spells out an older `@taskless/cli` or `@taskless/cli-nightly` version
- **THEN** each SHALL be reported with its path

#### Scenario: A current or floating CI pin is not reported

- **WHEN** a CI file runs `@taskless/cli` at the running version or at `latest`
- **THEN** no pin SHALL be reported for it

### Requirement: Init allows the installed CLI in each harness's permission file

`taskless init`, in the wizard and in `--no-interactive`, SHALL write a rule allowing exactly the installed CLI invocation to the project permission file of each harness it installs the skill for, from this table:

| Harness         | When                                   | File                                                                                                                | Rule                                                                                                                                            |
| --------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code     | `.claude/` selected                    | `.claude/settings.json`                                                                                             | `permissions.allow`: `Bash(<invocation> *)`                                                                                                     |
| Cursor (editor) | `.cursor/` selected                    | `.cursor/permissions.json`                                                                                          | `terminalAllowlist`: `<invocation>`                                                                                                             |
| Cursor (CLI)    | `.cursor/` selected                    | `.cursor/cli.json`                                                                                                  | `permissions.allow`: `Shell(npx:<specifier>)` and `Shell(npx:<specifier> *)`                                                                    |
| OpenCode        | `.opencode/` selected                  | the existing `opencode.json` or `opencode.jsonc`, at the root or under `.opencode/`, else `.opencode/opencode.json` | object form: `permission.bash["<invocation> *"]: "allow"`; array form: `{ "action": "shell", "resource": "<invocation> *", "effect": "allow" }` |
| Codex           | `.agents/` selected and Codex detected | `.codex/rules/taskless.rules`                                                                                       | `prefix_rule(pattern=["npx", "<specifier>"], decision="allow")`                                                                                 |

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

- **WHEN** `.agents/` is selected and no Codex detection signal is present
- **THEN** `init` SHALL NOT create `.codex/`

#### Scenario: OpenCode comments survive

- **WHEN** the OpenCode file is `opencode.jsonc` with comments
- **THEN** the written file SHALL keep every comment

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

### Requirement: Init never overrides a deny or a file it cannot read

`init` SHALL NOT write a rule to a harness file that denies the invocation, or that holds a rule which would take precedence over the Taskless rule and refuse it. It SHALL NOT write to a file that does not parse. In each case it SHALL leave the file unchanged and name it in the summary with the reason.

#### Scenario: A user deny is respected

- **WHEN** `.claude/settings.json` denies `Bash(npx *)`
- **THEN** `init` SHALL NOT add the allow rule
- **AND** the summary SHALL say the file denies the invocation

#### Scenario: A malformed file is not overwritten

- **WHEN** `.cursor/cli.json` does not parse
- **THEN** `init` SHALL leave it byte-identical and report it

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

### Requirement: Init writes the package's lockfile beside its launcher

Every `init` that writes a launcher SHALL also write this build's lockfile for the same package beside it: `.taskless/bin/cli.lock.json` for the release and `.taskless/bin/cli-nightly.lock.json` for the nightly. It SHALL NOT write, change or remove the other package's lockfile. A lockfile whose bytes differ from this build's SHALL be rewritten, and the install summary SHALL name it as restored. A `self` build SHALL write no lockfile. No scaffold migration SHALL be added for this.

#### Scenario: A release install writes its lockfile

- **WHEN** the release's `init` runs at `0.13.1`
- **THEN** `.taskless/bin/cli.lock.json` SHALL hold this build's lockfile, naming `@taskless/cli` at `0.13.1`

#### Scenario: A nightly install leaves the release's lockfile alone

- **WHEN** `.taskless/bin/cli.lock.json` exists and a nightly `init` runs
- **THEN** `.taskless/bin/cli-nightly.lock.json` SHALL be written
- **AND** `.taskless/bin/cli.lock.json` SHALL be unchanged

#### Scenario: An edited lockfile is restored and reported

- **WHEN** `.taskless/bin/cli.lock.json` was edited and the release's `init` runs
- **THEN** the file SHALL hold this build's lockfile afterwards
- **AND** the summary SHALL name it as restored

### Requirement: Init removes cached CLI versions nothing records

After `init` records versions under `install.launchers`, it SHALL remove every entry in `.taskless/.cache/` that is not the version recorded for either package, and every temporary install directory more than an hour old, by the same rule the launcher uses. Removal SHALL be best effort: an entry that cannot be removed SHALL be left without failing `init`. `init` SHALL NOT install anything into `.taskless/.cache/`; the launcher does that on its first run.

#### Scenario: An upgrade drops the previous release

- **WHEN** `.taskless/.cache/` holds `@taskless/cli@0.13.0` and the release's `init` runs at `0.13.1`
- **THEN** `@taskless/cli@0.13.0` SHALL no longer be in the cache
- **AND** nothing SHALL be installed for `0.13.1`

#### Scenario: A nightly install keeps the release's cache

- **WHEN** `.taskless/.cache/` holds `@taskless/cli@0.13.0`, `install.launchers` records it, and a nightly `init` runs
- **THEN** `@taskless/cli@0.13.0` SHALL remain in the cache
