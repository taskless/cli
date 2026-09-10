# Topic: init     (CLI v%(CLI_VERSION)s / topic v2)
Resolved by the CLI when you fetched it. Your next Taskless task, in this session or another, fetches it again with `%(TASKLESS_CLI)s agent <topic>`; do not reuse this copy.

## Goal
Install or update the Taskless skill in this project, and migrate the
`.taskless/` layout when the project is behind the CLI. You most often
arrive here because `check`, `verify`, or `test` refused with
`SCAFFOLD_MIGRATION_REQUIRED`: those commands only read, so the rewrite
is left to `init`, which is the one command that migrates.

An install rewrites files under version control and can change what an
upgrade means for the rules already in the project. Running the command
is the first of three steps, not the whole job.

## Preconditions
- None at the project level. The command works in any directory and
  bootstraps `.taskless/` on first run.
- No auth. `init` never calls the Taskless API.
- The wizard needs a TTY. You do not have one, so use the flag below.

## Steps

1. **Run the non-interactive install.**
   ```
   %(TASKLESS_CLI)s init --no-interactive --json
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
                   "files": { "added": [], "modified": [], "removed": [] } }
   }
   ```
   - `cliVersion.previous` is `null` on a project with no recorded
     install. When it differs from `installed`, the CLI was upgraded.
   - `targets` lists every install location and what this run wrote or
     removed there, by name. `mode: "canonical"` is the `.taskless/`
     store; `reference` is a tool directory holding stubs.
   - `changed` is `true` when a migration ran or any target list is
     non-empty. When it is `false`, stop here: nothing to commit,
     nothing to reconcile.
   - `migrated` is present only when a migration ran, with the paths it
     added, rewrote, or deleted.

   Without `--json`, the same facts print as prose: a per-target summary,
   then a trailer naming the directories that changed and, after a
   version move, pointing at `update`.

2. **Commit what changed.** Every `targets[].dir` with a non-empty list,
   plus `.taskless/` and any `migrated.files` entries, now holds changes
   that belong in the working tree's next commit. Stage them with the
   work you were doing, or as their own commit if the user prefers, and
   say what Taskless rewrote and why (a CLI upgrade, a layout migration).
   Do not leave them for whoever commits next.

3. **After a version move, reconcile the rules.** When
   `cliVersion.previous` is non-null and differs from `installed`, run
   ```
   %(TASKLESS_CLI)s update
   ```
   and follow it. The migration moved the DIRECTORY; the rules in it may
   still need work an upgrade cannot do for them (a rewriter that now
   needs a `fix`, a rule whose matching semantics shifted under a new
   engine). `update` is how to find out, and the only way to record that
   the walk was done.

4. **Treat your own session as stale.** A tool loads its skill list once,
   at startup. If Taskless was installed or upgraded during this session,
   the skill text in your context is the previous version. Tell the user
   the skills changed and that a new session, or a skill reload, picks
   them up. Recipes are unaffected: every `agent <topic>` fetch reads the
   installed CLI.

5. **Return to what sent you here.** Re-run the command that refused.

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
