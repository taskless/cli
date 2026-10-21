# Topic: init     (CLI v%(CLI_VERSION)s / topic v15)

%(ONE_COMMAND_PER_CALL)s

## Goal
Install or update the Taskless skill in this project, and migrate the
`.taskless/` layout when the project is behind the CLI. You most often
arrive here because `check`, `validate`, or `verify` refused with
`SCAFFOLD_MIGRATION_REQUIRED`: those commands only read, so the rewrite
is left to `init`, which is the one command that migrates.

An install rewrites files under version control, can leave a pinned CLI
in `package.json` behind the project, and can change what an upgrade
means for the rules already in the project. Running the command is the
first step, not the whole job.

## Preconditions
- None at the project level. The command works in any directory and
  bootstraps `.taskless/` on first run.
- No auth. `init` never calls the Taskless API.
- No TTY needed. `init` is the batch path in every context; the wizard
  is only reached by running the CLI with no subcommand in a terminal.

## Steps

1. **Run the install.**
   ```
   %(TASKLESS_CLI)s init --json
   ```
   The envelope:
   ```json
   {
     "success": true,
     "cliVersion": { "previous": "0.10.2", "installed": "0.11.1" },
     "targets": [
       { "dir": ".taskless", "mode": "canonical",
         "writtenSkills": ["taskless"],
         "removedSkills": [], "removedCommands": [] },
       { "dir": ".claude", "mode": "reference",
         "writtenSkills": ["taskless"],
         "removedSkills": [], "removedCommands": ["tskl.md"] }
     ],
     "changed": true,
     "migrated": { "from": 3, "to": 4, "applied": [4],
                   "files": { "added": [], "modified": [], "removed": [] } },
     "pinnedCli": [
       { "manifest": "packages/app/package.json",
         "location": "devDependencies", "name": "@taskless/cli",
         "spec": "^0.10.0", "installed": "0.10.2",
         "reason": "dependency" }
     ],
     "permissions": [
       { "file": ".claude/settings.json", "created": false,
         "allowed": ["Bash(%(TASKLESS_CLI)s *)"],
         "removed": [], "skipped": null }
     ],
     "globalTrust": [
       { "harness": "Claude Code", "file": "/Users/you/.claude/settings.json",
         "key": "autoMode.allow", "state": "absent", "skipped": null,
         "labelled": 0 }
     ],
     "launcher": { "path": ".taskless/bin/cli.mjs", "state": "unchanged" },
     "lockfile": { "path": ".taskless/bin/cli.lock.json", "state": "unchanged" },
     "retired": [],
     "telemetry": { "enabled": true }
   }
   ```
   - `cliVersion.previous` is `null` on a project with no recorded
     install. When it differs from `installed`, the CLI was upgraded.
   - `targets` lists every install location and what this run wrote or
     removed there, by name. `mode: "canonical"` is the `.taskless/`
     store; `reference` is a tool directory holding stubs.
   - `changed` is `true` when a migration ran, any target list is
     non-empty, the launcher or its lockfile was created or restored, a
     nightly launcher was retired, or `cliVersion` or a
     launcher's recorded version moved (both rewrite
     `.taskless/taskless.json`). When it is `false` AND `pinnedCli` is
     empty, stop here: nothing to commit, nothing to reconcile, nothing
     to bump.
   - `migrated` is present only when a migration ran, with the paths it
     added, rewrote, or deleted.
   - `pinnedCli` is always present. Each entry names the Taskless CLI
     somewhere the project runs it. `manifest` is the file it lives in:
     the root's or a workspace package's `package.json`, with `location`
     the field in it, or a CI or hook file such as
     `.github/workflows/ci.yml`, with `location` the line. `reason` says
     what to do with it: `dependency` is any `package.json` dependency on
     the CLI, whatever its version (`installed` is the build it runs,
     `null` when nothing is installed); `stale` is a script, CI, or hook
     line naming an older version; `nightly` is a nightly left in one of
     those after a release install; `unreleased` is a release pin after a
     nightly migrated `.taskless/`. It is reported even when `changed` is
     `false`, because the entry and the project still disagree.
   - `permissions` is always present. Each entry is a harness settings
     file this run created, edited, or left alone: the rule allowing
     exactly this CLI version (`allowed`), every other Taskless rule it
     replaced, whatever version it named (`removed`), or, when `skipped`
     is set, why the file was left as it was (it denies the command, or
     does not parse). These files are the user's; name each one when you
     tell them what to commit.
   - `globalTrust` is always present, empty when no installed harness has
     a classifier that overrules project rules. Each entry is that
     harness's user-level settings file and whether its Taskless entry is
     `present`, `absent`, `stale` (an entry under this CLI's label, such
     as `Taskless CLI:` for the release, with older text, or more than one
     string under that label: `labelled` says how many), or `skipped`
     (with the reason). `init` only reads it; it is
     never written by this command, and you must not write it either.
     When it is `absent` or `stale`, tell the user that their agent may
     refuse Taskless commands the project rule allows, and that the
     printed `SKIPPED (global):` line names the entry to add, or to
     replace the old ones with, themselves, or that running `%(TASKLESS_CLI)s` with no
     arguments, in their own terminal, offers to do it (`init` itself
     never asks).

   - `telemetry` is always present. `enabled` is `false` when either
     `TASKLESS_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1` is set, or
     `.taskless/taskless.json` has `"telemetry": false`.

   Without `--json`, the same facts print as prose: a per-target summary,
   each permission edit as `Edited <file>` with `ALLOW:` and `REMOVE:`
   lines (or `SKIPPED:` with the reason), a `SKIPPED (global):` line for
   each missing or stale global trust entry, then a trailer naming the directories that
   changed and, after a
   version move, pointing at `update`, then a notice naming each
   `pinnedCli` entry and what to do with it, and, when telemetry is on, a
   notice naming its opt-outs.

   - `launcher` is this CLI's project launcher, `.taskless/bin/cli.mjs`
     (`cli-nightly.mjs` for a nightly), which runs the version recorded
     for it in `.taskless/taskless.json`. `state` is `created`,
     `restored` (it had been edited, and was put back), or `unchanged`.
     It is `null` for a build that installs none. The launcher is a file
     to commit with the rest of `.taskless/`.
   - `lockfile` is the npm lockfile beside the launcher,
     `.taskless/bin/cli.lock.json` (`cli-nightly.lock.json` for a
     nightly), with the same `state` values. It pins every package the
     launcher installs, so it is committed with the launcher. The
     launcher's first run of a version installs it into
     `.taskless/.cache/`, which ignores itself in git; `init` downloads
     nothing.
   - `retired` is always present, empty when nothing was removed. A
     nightly installs beside the release and never touches the release's
     launcher, lockfile, recorded version, or permission rules. A release
     install is the move back to mainline: it removes
     `.taskless/bin/cli-nightly.mjs` and `cli-nightly.lock.json`, listed
     here, along with the nightly's recorded version (its cached build is
     pruned) and its rules in `permissions[].removed`. The deletions are
     changes to commit.

2. **Tell the user what needs committing.** Every `targets[].dir` with
   a non-empty list, plus `.taskless/`, any `migrated.files` entries, and
   every `permissions[].file` without `skipped`, now holds changes that
   belong in version control. Name those paths and
   say what Taskless rewrote and why (a CLI upgrade, a layout migration),
   so the user can include them in the commit they choose. Do not stage
   or commit on your own; the git operations are theirs.

3. **Offer the `pinnedCli` changes.** Go by each entry's `reason`:
   - `dependency`: Taskless runs through the project launcher, not as a
     project dependency. Offer to remove the dependency, point anything
     that calls its `taskless` binary at `node .taskless/bin/cli.mjs`,
     and reinstall dependencies.
   - `stale`: offer to move the line to the installed version, or to the
     launcher. Editing the line is the whole fix.
   - `nightly`: offer to move the line back to `@taskless/cli`. A release
     install is the move back to mainline, so this is raised even when
     the nightly is newer by version.
   - `unreleased`: change nothing. A nightly installs beside the release,
     so never move a `@taskless/cli` pin onto the nightly. But the
     nightly migrated `.taskless/`, and a release that predates the new
     schema refuses the project with `SCAFFOLD_VERSION_MISMATCH`. Tell
     the user before they commit `.taskless/`, so they can hold the
     migration until a release that reads it ships.

   When `migrated` is present with `from` above `0`, say plainly that CI
   on an older CLI breaks: a `dependency` or `stale` change belongs in the
   same commit as the migrated files. Do not edit a `package.json`, CI
   file, or hook on your own; a pin can be deliberate, and removing a
   dependency changes the lockfile.

4. **Tell the user about telemetry.** When `telemetry.enabled` is
   `true`, tell the user that Taskless collects anonymous telemetry
   (which command ran, whether it succeeded, how long it took, and counts
   of findings, never rule content, prompts, or source) and that they can
   opt out. Offer the project-wide switch: a top-level
   `"telemetry": false` in `.taskless/taskless.json`, beside the fields
   already there. That file is committed, so the setting turns telemetry
   off for everyone working in the repository, CI included; say so. For
   one person or one machine instead, setting
   `TASKLESS_TELEMETRY_DISABLED=1` in their environment does the
   same. Make the manifest edit only when the user
   asks for it, and leave every other field as it is. When `enabled` is
   `false`, say nothing about telemetry.

5. **After a version move, reconcile the rules.** When
   `cliVersion.previous` is non-null and differs from `installed`, run
   ```
   %(TASKLESS_CLI)s update
   ```
   and follow it. The migration moved the DIRECTORY; the rules in it may
   still need work an upgrade cannot do for them (a rewriter that now
   needs a `fix`, a rule whose matching semantics shifted under a new
   engine). `update` is how to find out, and the only way to record that
   the walk was done.

6. **Treat your own session as stale.** A tool loads its skill list once,
   at startup. If Taskless was installed or upgraded during this session,
   the skill text in your context is the previous version. Tell the user
   the skills changed and that a new session, or a skill reload, picks
   them up. Recipes are unaffected: every `agent <topic>` fetch reads the
   installed CLI.

7. **Return to what sent you here.** Re-run the command that refused.

## For a person at a terminal

`%(TASKLESS_CLI)s` with no subcommand launches an interactive wizard. It
offers a row per harness (Claude Code, OpenCode, Cursor, Codex, Gemini
CLI, Crush, Devin, and other `.agents` harnesses), listing the ones found in
the project first, pre-checked, then the ones found on this machine, asks
which to enable, offers a login (skippable), shows a diff against the
previous install, then writes the canonical `taskless` skill once to
`.taskless/` and a thin stub into each selected tool directory. Stale
layouts from older installs converge to stubs automatically; the retired
`tskl` slash command and v0.6-era per-task skills and commands are removed,
and the summary shows what went.

## Errors

- `SCAFFOLD_VERSION_MISMATCH`: the project's `.taskless/` is NEWER than
  this CLI. Upgrade the CLI; do not migrate downward.
- No tools detected → the skill is written to `.agents/skills/`. Not an
  error.
- Wizard cancelled (Ctrl-C) → no filesystem writes. Re-run when ready.

## See Also

- `%(TASKLESS_CLI)s update`: what an upgrade changed for existing rules
- `%(TASKLESS_CLI)s agent info`: verify what's installed and check staleness
- `%(TASKLESS_CLI)s agent auth`: authenticate after installing
