## MODIFIED Requirements

### Requirement: Skills use SKILL.md format with YAML frontmatter

The single skill SHALL be defined at `skills/taskless/SKILL.md` with YAML frontmatter (`name`, `description`, `metadata`) followed by markdown instructions. The `name` field SHALL be exactly `taskless` (no per-task prefix). The `metadata` field SHALL include `author` and `version` keys. The `version` SHALL be used for staleness detection when the skill is installed into target repositories.

The skill body SHALL begin by instructing the agent that it does NOT have step-by-step instructions for any Taskless action and that recipes must be fetched via `npx @taskless/cli agent <topic>` before proceeding. The body SHALL NOT contain inline step-by-step recipes for any individual task — those live in `packages/cli/src/agent/<topic>.md` files served by the `agent` subcommand.

#### Scenario: Skill directory contains valid SKILL.md

- **WHEN** the skill is built
- **THEN** `skills/taskless/SKILL.md` SHALL exist
- **AND** SHALL contain YAML frontmatter with `name: taskless` and `description` (up to 1024 chars)
- **AND** the `metadata` field SHALL include `author: taskless` and `version` (string matching CLI package version)
- **AND** the markdown body SHALL contain the router instructions described above (no per-task recipes inline)

#### Scenario: Skill body delegates to the CLI agent command

- **WHEN** the skill body is read
- **THEN** it SHALL instruct the agent to fetch the canonical recipe via `npx @taskless/cli agent <topic>` before performing any Taskless action
- **AND** SHALL NOT duplicate recipe content inline

**Distribution.**

### Requirement: Plugin manifest declares skills and commands

The `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` SHALL declare the single consolidated skill and no commands. The plugin version SHALL be `0.7.0` for this release. The plugin description MAY be updated to reflect the consolidation.

#### Scenario: Plugin manifest reflects consolidated bundle

- **WHEN** `plugin.json` is read
- **THEN** `version` SHALL be `0.7.0`
- **AND** it SHALL NOT declare `commands`

## REMOVED Requirements

### Requirement: Commands directory contains Claude Code command files

**Reason**: The `tskl` slash command is removed; the `taskless` skill is the only agent-facing entry point.

**Migration**: Ask the agent in plain language; the skill triggers on it. An upgrade removes installed `tskl` command files.
