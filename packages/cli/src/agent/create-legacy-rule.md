# Topic: create-legacy-rule     (CLI v%(CLI_VERSION)s / topic v3)

%(ONE_COMMAND_PER_CALL)s

## You are here
This is `create-legacy-rule`. It solves a request with a linter the
repository already runs (ESLint, Ruff, Biome, pylint, flake8, and
others), in that tool's own configuration, so that tool enforces it.
If that is not the kind of check you need, re-run `%(TASKLESS_CLI)s agent route`
and follow its decision rather than adapting this recipe.

## Goal
Find a rule the linter already ships that solves the request, and enable
or configure it. Write a new custom rule in that linter only when the
repository already has five or more of its own to model it on. Taskless
does not teach custom-rule authoring for any linter: the repository's
own rules are the only reference.

## Preconditions
- The repo has a detected linter (confirm via `%(TASKLESS_CLI)s detect --json`).
- The agent can read and write files. Web access helps find a shipped
  rule, but is not required.
- No auth required.

## Steps

1. **Confirm the target tool.** Use `%(TASKLESS_CLI)s detect --json` to see
   which linters are configured. If more than one could host this rule,
   ask the user which tool should own it.

2. **Look for a rule the tool already ships.** Always do this first,
   however little the repo has configured.
   - **Start with the tool's catch-all rules**, the ones that take your
     own pattern or list and a message: ESLint's `no-restricted-syntax`
     and `no-restricted-imports`, Ruff's `banned-api`, Biome's
     `noRestrictedImports`, pylint's `deprecated-modules`. A search for
     the request's subject does not find these, so check them by name.
   - **Then the tool's own rule list and the plugins the repo already
     has installed.** Prefer the tool's current documentation, and an
     `llms.txt` on its docs site when there is one. Confirm the rule
     exists in the version the repo has installed before you rely on it.
   - **A plugin the repo does not have is a new dependency.** Name the
     package and ask the user before adding it.

3. **Enable or configure that rule** where the tool expects its
   configuration, matching how the repo's existing configuration is
   written: its file, its severity choices, its ordering.

4. **No shipped rule fits: check the repo's own rules.** Read
   `customRules` for this linter in `detect --json`.
   - **A `count` of 5 or more:** you may write a new rule. Read the repo's
     rules listed in `evidence` first and model yours on them: their
     structure, naming, tests, and how they are registered. Do not reach
     for the tool's authoring documentation instead.
   - **Fewer than 5, `"unknown"`, or no `customRules` at all:** do not
     write a custom rule. Return to `%(TASKLESS_CLI)s agent route` and
     continue to step 3 of its legacy ladder, a Taskless rule.

5. **Report, and be explicit about who runs it.** Show the file(s) you
   changed. Make clear that the user's OWN toolchain runs this rule:
   `%(TASKLESS_CLI)s check` does NOT execute external linters. Tell the user how
   to run their linter to see it fire (e.g. their existing lint script).

## Important Notes

- Do not invent linter rules from memory: confirm a rule against the
  installed version before enabling it.
- This path writes the rule in the tool's configuration and hands off.
  Taskless does not aggregate or run external linters.

## See Also

- `%(TASKLESS_CLI)s agent route`: re-decide the destination if this no longer fits
- `%(TASKLESS_CLI)s agent create-sg-rule`: author a local ast-grep rule instead
- `%(TASKLESS_CLI)s agent create-remote-rule`: generate via the service (login)
