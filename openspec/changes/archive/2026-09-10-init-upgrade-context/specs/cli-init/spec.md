## ADDED Requirements

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

- **WHEN** a user with v0.6 installed (10 per-task skills written) runs the v0.7.0 `taskless init`
- **THEN** the install plumbing SHALL read the previous install state from `.taskless/taskless.json`
- **AND** SHALL delete the 10 obsolete skill files and 6 obsolete command files
- **AND** SHALL write the new `taskless` skill and `tskl` command
- **AND** SHALL update `.taskless/taskless.json` install state to reflect the new layout

#### Scenario: Init reports cleanup transparently

- **WHEN** init removes obsolete files
- **THEN** the install summary output SHALL include "removed N obsolete skills" and "removed M obsolete commands"
- **AND** SHALL list the obsolete skill names so the user understands what changed

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

### Requirement: Skills are installed as Agent Skills spec SKILL.md files

The CLI SHALL install skill content using a canonical-store-plus-stub model rather than writing a full copy per detected tool. The full skill content SHALL be written exactly once to the canonical `.taskless/skills/<name>/SKILL.md`. Each selected tool directory SHALL receive its own reference stub as defined by the reference-stub requirement. Skill names SHALL be installed verbatim from the embedded source. No additional namespace prefixing SHALL be applied at install time.

The skill and command sources SHALL name the CLI through the `%(TASKLESS_CLI)s` placeholder, the same token the recipes use, and SHALL NOT contain the literal `npx @taskless/cli` in their bodies. The canonical write renders the placeholder to the build's own invocation (`npx @taskless/cli` for a release build, the pinned nightly or path-form invocation otherwise). Rendering is an exact-token substitution, not a search for the literal invocation in prose: a literal is whitespace-sensitive, so a wrapped line or a doubled space silently escaped the rewrite and reached a nightly install naming the release package.

#### Scenario: Canonical skill content matches source

- **WHEN** a skill is installed
- **THEN** the canonical `.taskless/skills/<name>/SKILL.md` content SHALL be identical to the embedded source from `skills/` with every `%(TASKLESS_CLI)s` rendered to the build's invocation, which for a release build is `npx @taskless/cli`
- **AND** no frontmatter fields SHALL be modified at install time

#### Scenario: The sources carry the placeholder, not the literal

- **WHEN** the skill and command sources under `skills/` and `commands/` are read
- **THEN** each body SHALL contain `%(TASKLESS_CLI)s` wherever it names the CLI
- **AND** SHALL NOT contain the literal `npx @taskless/cli`
- **AND** the rendered canonical content SHALL contain no unrendered `%(` token

#### Scenario: Selected tool directory receives a stub, not a full copy

- **WHEN** the CLI installs the `taskless` skill and any tool directory is selected
- **THEN** that directory's skill location SHALL contain a reference stub
- **AND** SHALL NOT contain a full copy of the canonical skill content
