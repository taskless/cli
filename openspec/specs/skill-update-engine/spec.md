# Skill: Update Engine

## Purpose

The `taskless-update-engine` skill: how it asks the CLI for a scaffold upgrade and reports the outcome back to the user.

## Requirements

### Requirement: Update-engine skill invokes CLI and reports status

The `taskless-update-engine` skill SHALL exist at `skills/taskless-update-engine/SKILL.md`. When invoked, the agent SHALL run `taskless update-engine --json` and report the result to the user.

#### Scenario: Project is already current

- **WHEN** the update-engine skill is invoked and the CLI returns `{ "status": "current" }`
- **THEN** the agent SHALL inform the user that their project is already up to date

#### Scenario: PR is created

- **WHEN** the update-engine skill is invoked and the CLI returns `{ "status": "open", "prUrl": "<url>" }`
- **THEN** the agent SHALL display the PR URL to the user
- **AND** suggest the user review and merge the PR

#### Scenario: PR already exists

- **WHEN** the update-engine skill is invoked and the CLI returns `{ "status": "exists", "requestId": "<id>", "prUrl": "<url>" }`
- **THEN** the agent SHALL display the existing PR URL
- **AND** suggest the user review and merge it

#### Scenario: CLI errors

- **WHEN** the update-engine CLI exits with a non-zero exit code
- **THEN** the agent SHALL report the error message to the user
- **AND** suggest corrective actions (e.g., run `taskless auth login`, check `taskless.json`)

### Requirement: Update-engine skill has correct frontmatter

The skill's YAML frontmatter SHALL include `name: taskless-update-engine`, a description mentioning engine/scaffold upgrades, and `metadata` with `author: taskless` and `version` matching the CLI version.

#### Scenario: Frontmatter is valid

- **WHEN** inspecting `skills/taskless-update-engine/SKILL.md`
- **THEN** the frontmatter SHALL have `name: taskless-update-engine`
- **AND** `metadata.author` SHALL be `taskless`
- **AND** `metadata.version` SHALL match the CLI package version

### Requirement: Update-engine skill detects package manager

The skill SHALL detect the project's package manager and use the appropriate invocation command, consistent with other Taskless skills.

#### Scenario: Invocation with pnpm

- **WHEN** the skill is invoked in a project with `pnpm-lock.yaml`
- **THEN** the agent SHALL run `pnpm dlx @taskless/cli@latest update-engine --json`

#### Scenario: Invocation with npm

- **WHEN** the skill is invoked in a project without `pnpm-lock.yaml`
- **THEN** the agent SHALL run `npx @taskless/cli@latest update-engine --json`
