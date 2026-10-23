# Topic: create-legacy-rule (biome)     (CLI v%(CLI_VERSION)s / topic v1)

%(ONE_COMMAND_PER_CALL)s

## You are here
This is `create-legacy-rule` for Biome. It solves a request by enabling
or configuring a rule Biome already ships. When nothing here fits,
re-run `%(TASKLESS_CLI)s agent route` and continue from step 3 of its legacy
ladder.

## Goal
Find the Biome rule that makes the problem go away, confirm it in the
installed version, and enable it in the repository's Biome configuration.

## Preconditions
- `%(TASKLESS_CLI)s detect --json` reports `biome`.
- No auth required.

## Steps

1. **Always check the catch-all rules first.** They take your own list
   and message, and a search for the request's subject will not surface
   them:
   - `noRestrictedImports` (group `style`): bans modules or named
     imports, with a message.
   - `noRestrictedGlobals` (group `style`): bans global names, such as
     `event` or `location`.
   Both do nothing until they are given a list, so a repo that has not
   configured them is not using them.

2. **Otherwise, find a shipped rule.** Biome ships hundreds of rules,
   too many to match a request against from the command line. Search
   the rules page, https://biomejs.dev/linter/rules/, for the behavior
   the request describes. Many rules port a well-known ESLint rule, and
   the page names the source.

3. **Confirm the rule against the installed version.** Run
   `biome explain <ruleName>` (for example `biome explain noRestrictedImports`).
   It prints the rule's documentation, including its group and options,
   or fails when the installed version does not have it.

4. **Enable it where the repo configures Biome.** Biome reads
   `biome.json`, `biome.jsonc`, `.biome.json`, or `.biome.jsonc`, from
   the current directory up. A nested config marks itself with
   `"root": false` or `"extends": "//"`, and `extends` can pull rules
   and plugins in from a package, so read what a config extends before
   assuming a rule is off. Rules go under `linter.rules.<group>.<rule>`:
   ```json
   "linter": { "rules": { "style": { "noRestrictedImports": {
     "level": "error",
     "options": { "paths": { "lodash": "Use the helpers in src/util." } }
   } } } }
   ```
   Use `overrides` when the rule should apply to some paths only.

5. **Report, and say who runs it.** Show the file you changed and the
   command that shows the rule firing, e.g. `biome lint <path>`.
   `%(TASKLESS_CLI)s check` does NOT run Biome.

## Important Notes

- Do not write a Biome plugin. GritQL and JavaScript plugins exist, but
  Taskless does not teach authoring them. A request no shipped rule
  solves is a Taskless rule.
- Biome 2 changed the configuration format. On Biome 1, check the
  installed version's docs before copying a snippet.

## See Also

- `%(TASKLESS_CLI)s agent route`: continue down the legacy ladder when no Biome rule fits
- `%(TASKLESS_CLI)s agent create-sg-rule`: ast-grep parses JavaScript and TypeScript
