## ADDED Requirements

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

- `ALLOW: <rule>` for a rule added, rendered in green.
- `REMOVE: <rule>` for a recorded rule taken out on upgrade, rendered in red.
- `SKIPPED: <file>` with the reason, for a file left alone because it denies the invocation or does not parse, rendered in yellow.

The first line SHALL say `Created` for a file Taskless created and `Edited` for one that existed. The labels SHALL carry the meaning on their own, so the output reads the same with color off (`NO_COLOR`, no TTY). Color SHALL come from the CLI's shared color setup, so it follows the real terminal.

The wizard SHALL show the same lines in its summary step, before anything is written, so the user sees each permission edit before confirming. `--no-interactive` SHALL print them after writing. Under `--json` they SHALL go to stderr with the rest of the human summary, and the envelope SHALL carry the same information as data: per file, the path, whether it was created, the rules allowed and removed, and any skip reason.

#### Scenario: A first install names the edit

- **WHEN** `init --no-interactive` adds a rule to an existing `.claude/settings.json`
- **THEN** the output SHALL include `Edited .claude/settings.json` followed by `ALLOW: Bash(<invocation> *)`
- **AND** with color on, the `ALLOW` line SHALL be green

#### Scenario: An upgrade shows both sides

- **WHEN** `init` replaces a recorded `0.13.0` rule with the `0.13.1` rule
- **THEN** the output SHALL list `ALLOW:` for the `0.13.1` rule and `REMOVE:` for the `0.13.0` rule under the file's name

#### Scenario: The wizard previews before writing

- **WHEN** the wizard reaches its summary step for an install that will edit `.cursor/cli.json`
- **THEN** the summary SHALL show the file and its `ALLOW:` lines before the user confirms
- **AND** nothing SHALL be written if the user cancels

#### Scenario: Color off still reads

- **WHEN** `NO_COLOR` is set
- **THEN** the lines SHALL carry the same `ALLOW:`, `REMOVE:`, and `SKIPPED:` labels with no escape sequences

#### Scenario: JSON carries the edits as data

- **WHEN** `init --json` edits a permission file
- **THEN** the envelope SHALL report that file's path, whether it was created, and the exact rules allowed and removed

### Requirement: Init never overrides a deny or a file it cannot read

`init` SHALL NOT write a rule to a harness file that denies the invocation, or that holds a rule which would take precedence over the Taskless rule and refuse it. It SHALL NOT write to a file that does not parse. In each case it SHALL leave the file unchanged and name it in the summary with the reason.

#### Scenario: A user deny is respected

- **WHEN** `.claude/settings.json` denies `Bash(npx *)`
- **THEN** `init` SHALL NOT add the allow rule
- **AND** the summary SHALL say the file denies the invocation

#### Scenario: A malformed file is not overwritten

- **WHEN** `.cursor/cli.json` does not parse
- **THEN** `init` SHALL leave it byte-identical and report it

### Requirement: The manifest records permission rules, and an upgrade replaces only those

The manifest SHALL record, under `install.permissions`, each file Taskless wrote a rule to, the exact rule entries it added, and whether Taskless created the file. On a later `init` the installer SHALL remove exactly the recorded entries and write the current ones. It SHALL NOT remove or edit any entry it did not record, including a rule for Taskless the user wrote. A file Taskless created SHALL be deleted when removing its entries leaves it holding nothing else; a file that existed before SHALL never be deleted.

#### Scenario: An upgrade swaps the version

- **WHEN** the manifest records `Bash(npx @taskless/cli@0.13.0 *)` in `.claude/settings.json` and `init` runs at `0.13.1`
- **THEN** the file SHALL contain `Bash(npx @taskless/cli@0.13.1 *)` and not the `0.13.0` rule
- **AND** the manifest SHALL record only the `0.13.1` rule

#### Scenario: A user's own rule survives an upgrade

- **WHEN** `.claude/settings.json` also holds `Bash(npx @taskless/cli@0.12.0 *)`, which the manifest does not record
- **THEN** an upgrade SHALL leave that entry in place
