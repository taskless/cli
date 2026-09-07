# Topic: init     (CLI v%(CLI_VERSION)s / topic v1)

## Goal
Install or update the Taskless skill into the user's coding-agent
tools (Claude Code, OpenCode, Cursor, etc.). The user runs this
themselves, the agent's role is mostly to point the user at the
right command when they need to install or upgrade.

## Preconditions
- None at the user level. The command works in any directory and
  bootstraps `.taskless/` on first run.
- For interactive mode: a TTY (running from a terminal).

## Steps

The user should run:
```
%(TASKLESS_CLI)s
```
(no subcommand). In a TTY this launches the interactive wizard. In
non-TTY contexts it prints the topic index instead.

For scripted installs (CI, Dockerfiles):
```
%(TASKLESS_CLI)s init --no-interactive
```

The wizard will:
1. Detect installed tools (Claude Code, OpenCode, Cursor) and ask
   which tools to enable Taskless for.
2. Show the auth tradeoff and offer to log in (skippable).
3. Show a diff against the previous install state before writing.
4. Write the canonical `taskless` skill (and `tskl` command) once to
   `.taskless/`, then a thin reference stub into each selected tool
   directory (`.claude/`, `.cursor/`, `.opencode/`, `.agents/`).
5. Update `.taskless/taskless.json` with the install manifest.

The skill content lives in exactly one place, `.taskless/skills/`,
and each tool directory holds only a short stub that points at it.
Stale layouts from older installs (full per-tool copies, symlinks)
are converged into stubs automatically. If the user is on v0.6 or
earlier, the obsolete per-task skills (taskless-check, etc.) and old
slash commands are removed as part of the install; the summary shows
what was removed.

## Errors

- Wizard cancelled (Ctrl-C) → no filesystem writes. Re-run when ready.
- No tools detected → falls back to `.agents/skills/`.

## See Also

- `%(TASKLESS_CLI)s agent info`: verify what's installed and check staleness
- `%(TASKLESS_CLI)s agent auth`: authenticate after installing
