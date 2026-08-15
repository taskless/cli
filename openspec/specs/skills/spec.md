# Skills

## Purpose

Defines the structure, conventions, and distribution model for Taskless skills, including repo layout, Claude Code Plugin Marketplace manifest, and multi-channel distribution.

## Requirements

### Requirement: Skills use SKILL.md format with YAML frontmatter

The single skill SHALL be defined at `skills/taskless/SKILL.md` with YAML frontmatter (`name`, `description`, `metadata`) followed by markdown instructions. The `name` field SHALL be exactly `taskless` (no per-task prefix). The `metadata` field SHALL include `author`, `version`, and `commandName: tskl` keys. The `version` SHALL be used for staleness detection when the skill is installed into target repositories.

The skill body SHALL begin by instructing the agent that it does NOT have step-by-step instructions for any Taskless action and that recipes must be fetched via `npx @taskless/cli agent <topic>` before proceeding. The body SHALL NOT contain inline step-by-step recipes for any individual task — those live in `packages/cli/src/help/<topic>.txt` files served by the help subcommand.

#### Scenario: Skill directory contains valid SKILL.md

- **WHEN** the skill is built
- **THEN** `skills/taskless/SKILL.md` SHALL exist
- **AND** SHALL contain YAML frontmatter with `name: taskless` and `description` (up to 1024 chars)
- **AND** the `metadata` field SHALL include `author: taskless`, `version` (string matching CLI package version), and `commandName: tskl`
- **AND** the markdown body SHALL contain the router instructions described above (no per-task recipes inline)

#### Scenario: Skill body delegates to CLI help

- **WHEN** the skill body is read
- **THEN** it SHALL instruct the agent to fetch the canonical recipe via `npx @taskless/cli agent <topic>` before performing any Taskless action
- **AND** SHALL NOT duplicate recipe content inline

**Distribution.**

### Requirement: Skills live in the standard discovery path

All Taskless skills SHALL be located at `skills/<name>/SKILL.md` in the repository root. The `skills/` directory is the standard discovery path recognized by the Vercel skills CLI and multiple agent tools. The `plugins/taskless/skills/` directory SHALL NOT be used.

#### Scenario: Skill exists at standard path

- **WHEN** a skill named `taskless-info` is added to the repository
- **THEN** it SHALL exist at `skills/taskless-info/SKILL.md`

#### Scenario: Skills are discoverable by Vercel skills CLI

- **WHEN** a user runs `npx skills add taskless/skills --list`
- **THEN** the CLI SHALL discover all skills under `skills/`

#### Scenario: Old plugins directory is not used

- **WHEN** inspecting the repository structure
- **THEN** the `plugins/` directory SHALL NOT exist

### Requirement: Skill names are globally qualified with taskless prefix

The single skill name SHALL be `taskless` (without a per-task suffix). When installed into a target tool, the skill SHALL be installed at `<tool>/skills/taskless/SKILL.md` (e.g. `.claude/skills/taskless/SKILL.md`).

#### Scenario: Skill name is exactly taskless

- **WHEN** the skill is installed into any tool location
- **THEN** the directory name SHALL be `taskless`
- **AND** SHALL NOT use a `taskless-<task>` per-task name

### Requirement: Commands directory contains Claude Code command files

The `commands/tskl/` directory SHALL contain exactly one command file (`tskl.md`) that maps to the consolidated skill. The command body SHALL accept a free-form `$ARGUMENTS` ask and route via the same flow as the skill (fetch `npx @taskless/cli agent <topic>`, follow the recipe). When `$ARGUMENTS` is empty or ambiguous, the command body SHALL instruct the agent to ask the user what they want to do.

#### Scenario: Single command file exists

- **WHEN** the v0.7.0 release is built

- **THEN** `commands/tskl/tskl.md` SHALL exist
- **AND** no other command files SHALL exist in `commands/tskl/`

#### Scenario: Command file is a router

- **WHEN** the command body is read
- **THEN** it SHALL instruct the agent to handle `$ARGUMENTS` by inferring a topic, fetching its recipe, and proceeding
- **AND** SHALL specify behavior when `$ARGUMENTS` is empty (ask the user)

### Requirement: Claude Code Plugin Marketplace manifest exists

A `.claude-plugin/marketplace.json` file SHALL exist at the repository root defining a marketplace with a single `taskless` plugin. The marketplace SHALL conform to the Claude Code marketplace schema.

#### Scenario: Marketplace lists one plugin

- **WHEN** inspecting `.claude-plugin/marketplace.json`
- **THEN** the `plugins` array SHALL contain exactly one entry with `name: "taskless"`
- **AND** the `source` SHALL be `"."`

#### Scenario: Marketplace has required fields

- **WHEN** inspecting `.claude-plugin/marketplace.json`
- **THEN** it SHALL have `name`, `owner` (with `name`), and `plugins` fields

### Requirement: Plugin manifest declares skills and commands

The `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` SHALL declare the single consolidated skill and the single command. The plugin version SHALL be `0.7.0` for this release. The plugin description MAY be updated to reflect the consolidation.

#### Scenario: Plugin manifest reflects consolidated bundle

- **WHEN** `plugin.json` is read
- **THEN** `version` SHALL be `0.7.0`
- **AND** `commands` SHALL point to `./commands/tskl/`
- **AND** the bundled commands directory SHALL contain only `tskl.md`

### Requirement: Three distribution channels are supported

Skills SHALL be installable through three channels: `taskless init` (CLI), Claude Code Plugin Marketplace (`/plugin install`), and Vercel skills CLI (`npx skills add`). Each channel reads from the same source files in `skills/`.

#### Scenario: CLI route installs skills and commands

- **WHEN** a user runs `taskless init` in a project with `.claude/` directory
- **THEN** skills SHALL be placed in `.claude/skills/` and commands in `.claude/commands/taskless/`

#### Scenario: Marketplace route installs via plugin system

- **WHEN** a user runs `/plugin marketplace add taskless/skills` and `/plugin install taskless@taskless`
- **THEN** the plugin system SHALL install skills and commands from the repo

#### Scenario: Vercel CLI route discovers skills

- **WHEN** a user runs `npx skills add taskless/skills`
- **THEN** the skills CLI SHALL discover skills from the `skills/` directory
