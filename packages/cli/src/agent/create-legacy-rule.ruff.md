# Topic: create-legacy-rule (ruff)     (CLI v%(CLI_VERSION)s / topic v1)

%(ONE_COMMAND_PER_CALL)s

## You are here
This is `create-legacy-rule` for Ruff. It solves a request by enabling
or configuring a rule Ruff already ships. Ruff has no way to write a
custom rule, so when nothing here fits, the request is a Taskless rule:
re-run `%(TASKLESS_CLI)s agent route` and continue from step 3 of its legacy
ladder.

## Goal
Find the Ruff rule that solves the request, confirm it exists in the
installed version, and enable it in the repository's Ruff configuration.

## Preconditions
- `%(TASKLESS_CLI)s detect --json` reports `ruff`.
- Ruff is installed, or can be run through the repo's own tooling
  (`uv run ruff`, `poetry run ruff`, or the `ruff` on PATH).
- No auth required.

## Steps

1. **Always check `banned-api` first.** It is rule `TID251`, configured
   under `flake8-tidy-imports`, and it bans an import or an attribute
   with a message you write. It covers most "never call X" and "use Y
   instead of X" requests, and a search for the request's subject will
   not surface it:
   ```toml
   [tool.ruff.lint.flake8-tidy-imports.banned-api]
   "requests.get".msg = "Use the shared HTTP client in app.http."
   ```
   Enable it with `TID251` in `extend-select` if the repo has not
   already. `banned-module-level-imports` (`TID253`) is the companion
   for "import X lazily, inside the function".

2. **Otherwise, find a shipped rule.** Ruff ships hundreds of rules,
   too many to match a request against from the command line. Search
   the rules page, https://docs.astral.sh/ruff/rules/, for the behavior
   the request describes. Every rule has a code (`B006`) and a name
   (`mutable-argument-default`).

3. **Confirm the rule against the installed version.** Run
   `ruff rule <code-or-name>`. It prints the rule's documentation, or
   an error when the installed version does not have it. Read the top
   of the output:
   - **"This rule is in preview and is not stable."** The rule does not
     fire unless preview mode is on (`preview = true` under `[lint]`).
     Turning preview on enables every other preview rule in the
     selected set too, so tell the user and let them decide, or choose
     a stable rule instead. Never enable a preview rule in a
     configuration where it cannot fire.
   - **"Derived from the X linter."** The rule's settings live under
     `[lint.X]`, as `banned-api` does under `flake8-tidy-imports`.

4. **Enable it where the repo configures Ruff.** Ruff reads
   `.ruff.toml`, then `ruff.toml`, then `pyproject.toml` (only when it
   has a `[tool.ruff]` section), and uses the closest one to each file.
   It does not merge them; a file inherits another only through
   `extend = "..."`. Edit the file that actually governs the code the
   request is about. In `pyproject.toml` the keys are under
   `[tool.ruff.lint]`; in `ruff.toml` under `[lint]`. A top-level
   `select` is the deprecated spelling, so follow whichever the repo
   uses.
   - Add the code to `extend-select` rather than `select`. `select`
     replaces the default set, so adding to it can silently turn off
     the rules the repo relies on today.
   - Since Ruff 0.16 the default set is about 400 rules, up from 59, so
     check the rule is not already on before adding it.

5. **Report, and say who runs it.** Show the file you changed and the
   command that shows the rule firing, e.g. `ruff check <path>`.
   `%(TASKLESS_CLI)s check` does NOT run Ruff; the repo's own lint step
   does.

## Important Notes

- Do not write a Ruff plugin or a custom rule. Ruff has no mechanism
  for one, and the `customRules` count `detect` reports for Ruff is
  always 0.
- `ignore` and `per-file-ignores` turn rules off. They never solve a
  request to enforce something.

## See Also

- `%(TASKLESS_CLI)s agent route`: continue down the legacy ladder when no Ruff rule fits
- `%(TASKLESS_CLI)s agent create-sg-rule`: ast-grep parses Python, for the Taskless rule
