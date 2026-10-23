# Topic: create-legacy-rule (pylint)     (CLI v%(CLI_VERSION)s / topic v1)

%(ONE_COMMAND_PER_CALL)s

## You are here
This is `create-legacy-rule` for pylint. It solves a request with a
message pylint already ships, and writes a new checker only from the
repository's own examples. When neither fits, re-run
`%(TASKLESS_CLI)s agent route` and continue from step 3 of its legacy ladder.

## Goal
Enable or configure the pylint message that solves the request, in the
configuration the repository already uses.

## Preconditions
- `%(TASKLESS_CLI)s detect --json` reports `pylint`.
- pylint is installed, or can be run through the repo's own tooling.
- No auth required.

## Steps

1. **Always check the catch-all options first.** They take your own
   list, and a search for the request's subject will not surface them:
   - `deprecated-modules`: modules that must not be imported.
   - `preferred-modules`: `old:new` pairs, reporting the old module
     with the one to use instead.
   - `bad-functions`: builtin functions that must not be called. It
     belongs to the optional `pylint.extensions.bad_builtin` checker,
     which must be listed in `load-plugins` to run.

2. **Otherwise, find a shipped message.** Run `pylint --list-msgs` for
   every message the installed version knows, and
   `pylint --help-msg=<symbol>` for one. Messages from an optional
   extension (`pylint.extensions.*`) are missing from both unless the
   extension is loaded: `--help-msg=bad-builtin` reports "No such
   message id or symbol" until you add
   `--load-plugins=pylint.extensions.bad_builtin`. Load the extension
   before concluding a message does not exist.
   https://pylint.readthedocs.io/en/stable/user_guide/checkers/extensions.html

3. **Enable it where the repo configures pylint.** pylint uses the first
   config it finds: `pylintrc`, `pylintrc.toml`, `.pylintrc`,
   `.pylintrc.toml`, then `pyproject.toml` (with a `[tool.pylint.*]`
   section), `setup.cfg`, and `tox.ini`. Edit that one. pylint enables
   most messages by default, so check the message is not just listed in
   `disable` before adding anything.

4. **No shipped message fits: check the repo's own checkers.** Read
   `customRules` for `pylint` in `detect --json`.
   - **A `count` of 5 or more:** you may write a new checker. Read the
     modules in `evidence` first and model yours on them, including how
     `load-plugins` reaches them.
   - **Fewer than 5, or none:** do not write a checker. Return to
     `%(TASKLESS_CLI)s agent route`.

5. **Report, and say who runs it.** Show the file you changed and the
   command that shows the message firing, e.g. `pylint <path>`.
   `%(TASKLESS_CLI)s check` does NOT run pylint.

## Important Notes

- A long `disable` list weakens pylint rather than expressing a
  convention. Removing an entry from it can be the whole fix.

## See Also

- `%(TASKLESS_CLI)s agent route`: continue down the legacy ladder when no pylint message fits
- `%(TASKLESS_CLI)s agent create-sg-rule`: ast-grep parses Python, for the Taskless rule
