# Topic: create-legacy-rule (flake8)     (CLI v%(CLI_VERSION)s / topic v1)

%(ONE_COMMAND_PER_CALL)s

## You are here
This is `create-legacy-rule` for flake8. flake8's rules come from its
plugins and it has no command that lists them, so this recipe goes
straight to the one check that covers most requests. When it does not
fit, re-run `%(TASKLESS_CLI)s agent route` and continue from step 3 of its
legacy ladder.

## Goal
Ban a module or import with a message, through `banned-modules`, in the
configuration the repository already uses.

## Preconditions
- `%(TASKLESS_CLI)s detect --json` reports `flake8`.
- No auth required.

## Steps

1. **Use `banned-modules`.** It comes from the `flake8-tidy-imports`
   plugin and maps a module to the message shown when it is imported.
   It covers most "never import X" and "use Y instead of X" requests.
   ```ini
   [flake8]
   banned-modules =
     requests = Use the shared HTTP client in app.http.
     mock = Use unittest.mock.
   ```
   Its error code is `I251`. If the repo restricts codes with `select`,
   add `I25` there; `extend-select` (flake8 4.0 and later) adds it
   without replacing the existing selection.

2. **Check whether the plugin is installed.** `flake8 --bug-report`
   prints the installed plugins as JSON. If `flake8-tidy-imports` is
   missing, it is a new dependency: name it and ask the user before
   adding it.

3. **Edit the config flake8 actually reads.** flake8 reads the
   `[flake8]` section of `.flake8`, `setup.cfg`, or `tox.ini`. It does
   not read `pyproject.toml` on its own, so a `[tool.flake8]` table
   there only works through a third-party shim the repo would already
   have. User-level config is ignored since flake8 4.0.

4. **No catch-all fits: check the repo's own plugins.** Read
   `customRules` for `flake8` in `detect --json`.
   - **A `count` of 5 or more:** you may write a new checker. Read the
     `[flake8:local-plugins]` entries in `evidence` and the modules they
     point to, and model yours on them.
   - **Fewer than 5, or none:** do not write a checker. Return to
     `%(TASKLESS_CLI)s agent route`.

5. **Report, and say who runs it.** Show the file you changed and the
   command that shows the check firing, e.g. `flake8 <path>`.
   `%(TASKLESS_CLI)s check` does NOT run flake8.

## Important Notes

- Many `[flake8]` sections only set `max-line-length`, `exclude`, and
  `extend-ignore = E203` for Black. That is formatter accommodation,
  not a place the repo writes rules.

## See Also

- `%(TASKLESS_CLI)s agent route`: continue down the legacy ladder when `banned-modules` does not fit
- `%(TASKLESS_CLI)s agent create-sg-rule`: ast-grep parses Python, for the Taskless rule
