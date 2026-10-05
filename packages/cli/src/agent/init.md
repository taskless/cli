# Topic: init     (CLI v%(CLI_VERSION)s / topic v4)

## Goal
Install or update the Taskless skill in this project, and migrate the
`.taskless/` layout when the project is behind the CLI. You most often
arrive here because `check`, `verify`, or `test` refused with
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
     "commandsInstalled": true,
     "cliVersion": { "previous": "0.10.2", "installed": "0.11.1" },
     "targets": [
       { "dir": ".taskless", "mode": "canonical",
         "writtenSkills": ["taskless"], "writtenCommands": [],
         "removedSkills": [], "removedCommands": [] },
       { "dir": ".claude", "mode": "reference",
         "writtenSkills": ["taskless"], "writtenCommands": ["tskl.md"],
         "removedSkills": [], "removedCommands": [] }
     ],
     "changed": true,
     "migrated": { "from": 3, "to": 4, "applied": [4],
                   "files": { "added": [], "modified": [], "removed": [] } },
     "pinnedCli": [
       { "manifest": "packages/app/package.json",
         "location": "devDependencies", "name": "@taskless/cli",
         "spec": "^0.10.0", "installed": "0.10.2" }
     ]
   }
   ```
   - `cliVersion.previous` is `null` on a project with no recorded
     install. When it differs from `installed`, the CLI was upgraded.
   - `targets` lists every install location and what this run wrote or
     removed there, by name. `mode: "canonical"` is the `.taskless/`
     store; `reference` is a tool directory holding stubs.
   - `changed` is `true` when a migration ran, any target list is
     non-empty, or `cliVersion` moved (that rewrites
     `.taskless/taskless.json`). When it is `false` AND `pinnedCli` is
     empty, stop here: nothing to commit, nothing to reconcile, nothing
     to bump.
   - `migrated` is present only when a migration ran, with the paths it
     added, rewrote, or deleted.
   - `pinnedCli` is always present. Each entry is a pin that runs a
     Taskless CLI older than `installed`: a dependency whose installed
     build (`installed`, `null` when nothing is installed) or range is
     behind, or a script spelling out an older version. `manifest` is the
     `package.json` it lives in, the root's or a workspace package's, and
     `location` the field in it. It is reported even when `changed` is
     `false`, because the pin and the project still disagree.

   Without `--json`, the same facts print as prose: a per-target summary,
   then a trailer naming the directories that changed and, after a
   version move, pointing at `update`, then a notice naming each stale
   pin and the version to move it to.

2. **Tell the user what needs committing.** Every `targets[].dir` with
   a non-empty list, plus `.taskless/` and any `migrated.files` entries,
   now holds changes that belong in version control. Name those paths and
   say what Taskless rewrote and why (a CLI upgrade, a layout migration),
   so the user can include them in the commit they choose. Do not stage
   or commit on your own; the git operations are theirs.

3. **Offer to bump every stale pin.** For each `pinnedCli` entry, offer
   the user the update to the installed CLI, along with reinstalling
   dependencies. When the installed CLI is a nightly and the pin names
   `@taskless/cli`, or the reverse, the move switches package, since a
   nightly version only exists on the nightly package. When `migrated`
   is present with `from` above `0`, say plainly that CI breaks without
   it: a CLI that predates the new schema refuses the project with
   `SCAFFOLD_VERSION_MISMATCH`, so the bump belongs in the same commit as
   the migrated files. Do not edit a `package.json` on your own; a pin
   can be deliberate, and the bump changes the lockfile.

4. **After a version move, reconcile the rules.** When
   `cliVersion.previous` is non-null and differs from `installed`, run
   ```
   %(TASKLESS_CLI)s update
   ```
   and follow it. The migration moved the DIRECTORY; the rules in it may
   still need work an upgrade cannot do for them (a rewriter that now
   needs a `fix`, a rule whose matching semantics shifted under a new
   engine). `update` is how to find out, and the only way to record that
   the walk was done.

5. **Treat your own session as stale.** A tool loads its skill list once,
   at startup. If Taskless was installed or upgraded during this session,
   the skill text in your context is the previous version. Tell the user
   the skills changed and that a new session, or a skill reload, picks
   them up. Recipes are unaffected: every `agent <topic>` fetch reads the
   installed CLI.

6. **Return to what sent you here.** Re-run the command that refused.

## For a person at a terminal

`%(TASKLESS_CLI)s` with no subcommand launches an interactive wizard. It
detects the installed tools (Claude Code, OpenCode, Cursor, Codex), asks
which to enable, offers a login (skippable), shows a diff against the
previous install, then writes the canonical `taskless` skill (and `tskl`
command) once to `.taskless/` and a thin stub into each selected tool
directory. Stale layouts from older installs converge to stubs
automatically; v0.6-era per-task skills and commands are removed and the
summary shows what went.

## Errors

- `SCAFFOLD_VERSION_MISMATCH`: the project's `.taskless/` is NEWER than
  this CLI. Upgrade the CLI; do not migrate downward.
- No tools detected → the skill is written to `.agents/skills/` and no
  slash command is installed. Not an error.
- Wizard cancelled (Ctrl-C) → no filesystem writes. Re-run when ready.

## See Also

- `%(TASKLESS_CLI)s update`: what an upgrade changed for existing rules
- `%(TASKLESS_CLI)s agent info`: verify what's installed and check staleness
- `%(TASKLESS_CLI)s agent auth`: authenticate after installing
