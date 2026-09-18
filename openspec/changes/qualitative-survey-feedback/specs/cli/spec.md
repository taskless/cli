## MODIFIED Requirements

### Requirement: CLI manages .taskless/.gitignore

The CLI SHALL proactively create and maintain a `.taskless/.gitignore` file that ignores local-only files. The gitignore SHALL contain entries for `.env.local.json`, `sgconfig.yml`, and `/.tmp-*` (the scratch request files the agent recipes write, such as `.tmp-rule-request.json` and `.tmp-feedback.json`). Any CLI command that writes to `.taskless/` SHALL ensure the `.gitignore` file exists with these entries before writing.

#### Scenario: .gitignore is created when .taskless/ is first written to

- **WHEN** the CLI creates any file in `.taskless/` (e.g., during `auth login`, `rule create`, or `check`)
- **AND** `.taskless/.gitignore` does not exist
- **THEN** the CLI SHALL create `.taskless/.gitignore` containing `.env.local.json`, `sgconfig.yml`, and `/.tmp-*`

#### Scenario: Existing .gitignore is preserved

- **WHEN** `.taskless/.gitignore` already exists with additional user entries
- **AND** the CLI needs to ensure its entries are present
- **THEN** the CLI SHALL append any missing entries without removing existing content

#### Scenario: .gitignore entries are idempotent

- **WHEN** `.taskless/.gitignore` already contains `.env.local.json`, `sgconfig.yml`, and `/.tmp-*`
- **THEN** the CLI SHALL NOT duplicate the entries

#### Scenario: Scratch files are ignored on an existing scaffold

- **WHEN** a project scaffolded before `/.tmp-*` was an entry runs any command that bootstraps `.taskless/`
- **THEN** `.taskless/.gitignore` SHALL gain a `/.tmp-*` line
- **AND** a `.taskless/.tmp-feedback.json` left behind by an agent SHALL NOT appear in `git status`
