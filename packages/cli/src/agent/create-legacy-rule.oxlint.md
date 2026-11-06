# Topic: create-legacy-rule (oxlint)     (CLI v%(CLI_VERSION)s / topic v1)

%(ONE_COMMAND_PER_CALL)s

## You are here
This is `create-legacy-rule` for Oxlint. It solves a request by enabling
or configuring a rule Oxlint already ships. When nothing here fits,
re-run `%(TASKLESS_CLI)s agent route` and continue from step 3 of its legacy
ladder.

## Goal
Find the Oxlint rule that makes the problem go away, confirm it in the
installed version, and enable it in the repository's Oxlint configuration.

## Preconditions
- `%(TASKLESS_CLI)s detect --json` reports `oxlint`.
- No auth required.

## Steps

1. **Always check the catch-all rules first.** They take your own list,
   and a search for the request's subject will not surface them:
   - `no-restricted-imports`: bans modules or named imports, with a
     message, through `paths` and `patterns`.
   - `no-restricted-globals`: bans global names, such as `event`. Its
     documented form is a plain list of names, with no custom message.
   Both do nothing until they are given a list, so a repo that has not
   configured them is not using them.

   Oxlint has no `no-restricted-syntax`. A request for an AST selector
   is not solved here, so go back to `route`.

2. **Otherwise, find a shipped rule.** Search the rules page,
   https://oxc.rs/docs/guide/usage/linter/rules.html, for the behavior
   the request describes. Many rules port a well-known ESLint rule under
   the same name. The docs site also has an index at
   https://oxc.rs/llms.txt.

3. **Confirm the rule against the installed version.** Run
   `oxlint --rules`, which lists the rules the installed build has. A
   rule belonging to a plugin only fires when that plugin is on, and
   setting `plugins` replaces the default set, so read the config's
   `plugins` before relying on one.

4. **Enable it where the repo configures Oxlint.** Oxlint reads
   `.oxlintrc.json`, `.oxlintrc.jsonc`, `oxlint.config.ts`, or
   `oxlint.config.mts`. Each file uses the nearest config, and a nested
   config replaces its parent rather than merging with it, unless it
   says `extends`. So change the config that governs the files in
   question, which `oxlint --print-config` shows. Rules go under
   `rules`, as a severity or a `[severity, options]` pair:
   ```json
   "rules": {
     "no-restricted-imports": ["error", {
       "paths": [{ "name": "lodash", "message": "Use the helpers in src/util." }]
     }]
   }
   ```
   Use `overrides` when the rule should apply to some paths only.

5. **Report, and say who runs it.** Show the file you changed and the
   command that shows the rule firing, e.g. `oxlint <path>`.
   `%(TASKLESS_CLI)s check` does NOT run Oxlint.

## Important Notes

- Do not write an Oxlint plugin. JavaScript plugins exist, but they are
  in alpha and Taskless does not teach authoring them. A request no
  shipped rule solves is a Taskless rule.
- A repo running ESLint beside Oxlint may load `eslint-plugin-oxlint`,
  whose `buildFromOxlintConfigFile` turns off in ESLint the rules the
  Oxlint config enables. When a rule exists in both, enable it in
  Oxlint. Enabling it in ESLint there has no effect.

## See Also

- `%(TASKLESS_CLI)s agent route`: continue down the legacy ladder when no Oxlint rule fits
- `%(TASKLESS_CLI)s agent create-sg-rule`: ast-grep parses JavaScript and TypeScript
