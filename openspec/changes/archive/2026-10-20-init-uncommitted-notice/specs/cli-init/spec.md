## ADDED Requirements

### Requirement: The wizard offers to commit what it installed

After the wizard writes the install and the permission edits, and before its outro, it SHALL determine, when the project is inside a git working tree, which paths it owns are untracked, modified, or staged but not committed. The paths it owns SHALL be `.taskless/`, each install target's skill directory for every installed skill, and every permission file the manifest records a Taskless rule in. Permission files SHALL be read from the manifest, not from this run's edits, so a re-run that wrote nothing still includes them. Gitignored files SHALL NOT be included.

When any owned path is uncommitted, the wizard SHALL ask one question, saying that agents that work in worktrees won't see the files until they are committed, with exactly three choices:

1. Commit these files, with the message `chore: Installs Taskless and sets up coding agent support`.
2. Write my own commit message, which then asks for a non-empty message.
3. Don't commit, I'll do this myself.

The question SHALL NOT list the files. A commit SHALL contain only the uncommitted owned paths and SHALL leave anything else the user had staged staged and out of the commit. It SHALL run the user's own hooks and signing configuration. When git refuses the commit, the wizard SHALL show git's message and tell the user to commit the files themselves before starting their agent. Cancelling the question or the message prompt SHALL be read as "don't commit": the install is already written, so the wizard SHALL still complete and SHALL NOT report the install as cancelled.

The wizard SHALL NOT ask when every owned path is committed, when the project is not in a git repository, or when git cannot be run.

#### Scenario: Committing with the offered message

- **WHEN** the wizard completes in a git repository with the install uncommitted and an unrelated file staged, and the user chooses to commit these files
- **THEN** a commit SHALL be made with the message `chore: Installs Taskless and sets up coding agent support`
- **AND** it SHALL contain `.taskless/`, the installed skill, and the permission file
- **AND** the unrelated file SHALL remain staged and not be committed

#### Scenario: Committing with the user's message

- **WHEN** the user chooses to write their own commit message and enters one
- **THEN** the commit SHALL use that message, trimmed

#### Scenario: Declining leaves the files uncommitted

- **WHEN** the user chooses not to commit, or cancels the question
- **THEN** no commit SHALL be made
- **AND** the wizard SHALL complete

#### Scenario: Nothing to commit asks nothing

- **WHEN** the wizard runs and every owned path is committed, or the project is not in a git repository
- **THEN** the commit question SHALL NOT be asked

### Requirement: The batch install says a commit is owed

After a successful batch `taskless init`, when the project is inside a git working tree and any path it owns, as defined for the wizard's commit offer, is uncommitted, `init` SHALL print a boxed notice saying the files it installed are not committed yet, to commit them before starting the agent, and that agents that work in worktrees won't see uncommitted files. The notice SHALL NOT list the files and SHALL NOT commit anything. It SHALL be printed directly above the onboarding trailer, which stays the final line.

The notice SHALL NOT be printed when every owned path is committed, when the project is not in a git repository, or when git cannot be run. Under `--json` it SHALL NOT be printed, and stdout SHALL remain the envelope alone.

#### Scenario: An uncommitted install prints the notice

- **WHEN** a user runs `taskless init` in a git repository with nothing committed
- **THEN** the notice SHALL be printed before the onboarding trailer
- **AND** SHALL NOT name the installed skill directory

#### Scenario: A committed file that init edits prints the notice again

- **WHEN** every file `init` wrote is committed and a later `init` rewrites `.taskless/taskless.json`
- **THEN** the notice SHALL be printed

#### Scenario: Everything committed is silent

- **WHEN** a user re-runs `taskless init` and every path it owns is committed and unchanged
- **THEN** no notice SHALL be printed

#### Scenario: Outside a git repository is silent

- **WHEN** a user runs `taskless init` in a directory that is not in a git repository
- **THEN** no notice SHALL be printed
