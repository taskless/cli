## ADDED Requirements

### Requirement: Non-interactive init reports what an upgrade changed and what follows

`taskless init --no-interactive` SHALL tell its caller what an install changed beyond the files it wrote, because its caller is usually an agent that `check` sent there and that must decide what to do next.

On the human path, when the run changed anything (a migration ran, or any target had a skill or command written or removed), the CLI SHALL print an upgrade trailer AFTER the install summary and any reload notice and BEFORE the onboarding trailer, so the onboarding trailer stays the final line. The upgrade trailer SHALL:

- name each directory that now holds changed files (every target directory with a write or removal, and `.taskless/` when a migration ran or the recorded version moved), and state that those files belong in the next commit;
- when the recorded `install.cliVersion` moved (a previous version was recorded and differs from the one this run recorded), state the transition and that `taskless update` reports what the upgrade means for existing rules;
- be omitted entirely when nothing changed. A no-op re-install has nothing to commit and nothing to reconcile.

Under `--json`, the envelope SHALL carry the same facts as fields rather than prose:

- `cliVersion`: `{ previous: string | null, installed: string }`, where `previous` is the `install.cliVersion` read before this run and `null` when none was recorded;
- `targets`: one entry per install target, `{ dir, mode, writtenSkills, writtenCommands, removedSkills, removedCommands }`, with the four lists holding names, so the per-target summary that the human path prints is on the envelope instead of on stderr;
- `changed`: `true` when a migration ran, any target list above is non-empty, or the recorded version moved. A version move rewrites `install.cliVersion` in `.taskless/taskless.json`, a tracked file, so it is a change even when every skill byte already matched.

The `migrated` field is unchanged: present with the migration report when a migration ran, absent otherwise.

#### Scenario: An upgrade prints the trailer with both parts

- **WHEN** `taskless init --no-interactive` runs against a project whose recorded `install.cliVersion` differs from the running CLI, and the run writes at least one stub
- **THEN** stdout SHALL contain an upgrade trailer naming each directory that changed and saying those files belong in the next commit
- **AND** the trailer SHALL name the previous and installed versions and point at `taskless update`
- **AND** the onboarding trailer SHALL still be the final line

#### Scenario: A change without a version move omits the update pointer

- **WHEN** the run writes or removes files but the recorded `install.cliVersion` is the running version
- **THEN** the upgrade trailer SHALL name the changed directories and the commit obligation
- **AND** SHALL NOT mention `taskless update`

#### Scenario: A no-op re-install prints no upgrade trailer

- **WHEN** `taskless init --no-interactive` runs against a project that is already at the current scaffold version and whose every target reports up to date
- **THEN** stdout SHALL NOT contain the upgrade trailer

#### Scenario: The JSON envelope carries the version, targets, and changed flag

- **WHEN** `taskless init --no-interactive --json` runs
- **THEN** the envelope SHALL contain `cliVersion.previous` (a string or `null`), `cliVersion.installed`, a `targets` array with one entry per install target, and a boolean `changed`
- **AND** `changed` SHALL be `true` exactly when `migrated` is present, any target's written or removed list is non-empty, or `cliVersion.previous` is non-null and differs from `cliVersion.installed`

### Requirement: The migration refusal names the non-interactive path for a non-TTY caller

When a read-only command refuses a project whose scaffold is behind the CLI, the refusal SHALL tell the caller to run `init --no-interactive` when stdout is not a TTY, and `init` otherwise. An agent that follows the message verbatim SHALL never be sent to the wizard.

#### Scenario: A non-TTY caller is pointed at the non-interactive install

- **WHEN** `check` refuses a behind-the-CLI scaffold and stdout is not a TTY
- **THEN** the message SHALL contain `init --no-interactive`

#### Scenario: A TTY caller is pointed at the wizard

- **WHEN** `check` refuses a behind-the-CLI scaffold and stdout is a TTY
- **THEN** the message SHALL contain `init` and SHALL NOT contain `--no-interactive`

## MODIFIED Requirements

### Requirement: Update rewrites canonical content and preserves reference stubs

`taskless update` SHALL rewrite the canonical `.taskless/skills/` and `.taskless/commands/` content from the embedded bundle. A canonical file whose bytes already equal what the bundle would write SHALL be left untouched and SHALL NOT be reported as written: the install summary, the `--json` `targets` field, and the upgrade trailer all describe what changed on disk, and a byte-identical rewrite is not a change. For `reference`-mode targets, update SHALL create a stub only if it is missing, and SHALL NOT overwrite an existing stub with full canonical content. Update SHALL re-generate a stub in place only when its frontmatter `name`, `description`, or `metadata.version` has drifted from the canonical content; the stub's delegating body SHALL be preserved.

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
- **THEN** it SHALL NOT delete `.taskless/skills/` or `.taskless/commands/` as part of cleaning up any target
- **AND** the canonical content SHALL remain readable throughout the update
