# Topic: create-legacy-rule (eslint)     (CLI v%(CLI_VERSION)s / topic v1)

%(ONE_COMMAND_PER_CALL)s

## You are here
This is `create-legacy-rule` for ESLint, including typescript-eslint. It
solves a request with a rule ESLint or an installed plugin already
ships, and writes a new custom rule only from the repository's own
examples. When neither fits, re-run `%(TASKLESS_CLI)s agent route` and
continue from step 3 of its legacy ladder.

## Goal
Enable or configure the ESLint rule that solves the request, in the
configuration the repository already uses.

## Preconditions
- `%(TASKLESS_CLI)s detect --json` reports `eslint`.
- No auth required.

## Steps

1. **Find which config is live.** ESLint 9 made flat config
   (`eslint.config.{js,mjs,cjs,ts,mts,cts}`) the default, and ESLint 10
   removed `.eslintrc*` and `package.json#eslintConfig` entirely. Check
   the installed major version in the lockfile:
   - On 10, an `.eslintrc*` file is dead. Edit the flat config.
   - On 9, `.eslintrc*` is read only when `ESLINT_USE_FLAT_CONFIG=false`.
   - In a monorepo, ESLint 10 looks for the config from each linted
     file's directory upward, so a package can have its own.

2. **Always try a core rule first.** Two core rules take your own
   pattern and message, and cover most "never do X" requests:
   - **`no-restricted-syntax`**: an AST selector and a message. It bans
     any syntax shape a selector can describe, such as a call to a
     particular member or a particular literal.
     ```js
     "no-restricted-syntax": ["error", {
       selector: "CallExpression[callee.object.name='console'][callee.property.name='log']",
       message: "Use the logger in src/log.ts.",
     }]
     ```
   - **`no-restricted-imports`**: bans modules or named imports, with a
     message.
   - In a TypeScript repo, prefer the `@typescript-eslint/` counterparts
     where they exist: `@typescript-eslint/no-restricted-imports` (it
     also understands `import type`) and
     `@typescript-eslint/no-restricted-types`.
   If one of these rules is already configured, add an entry to it
   rather than a second copy: a rule set twice keeps only the last.
   Then check the rest of the core rules at
   https://eslint.org/docs/latest/rules/.

3. **Then a plugin, preferring one already installed.** These are the
   well-known plugins worth checking. Read the docs of any the repo
   already depends on before anything else:
   - `eslint-plugin-import`: import and export problems, such as
     unresolved paths, cycles, ordering, and duplicates.
     https://github.com/import-js/eslint-plugin-import
   - `eslint-plugin-regexp`: regular expression mistakes and style.
     https://ota-meshi.github.io/eslint-plugin-regexp/
   - `eslint-plugin-promise`: promise practice, such as missing returns
     or catches, and nesting.
     https://github.com/eslint-community/eslint-plugin-promise
   - `eslint-plugin-n`: Node.js, such as deprecated or unsupported APIs,
     module resolution, and `process` use.
     https://github.com/eslint-community/eslint-plugin-n
   - `eslint-plugin-react`: React component and JSX correctness and
     conventions. https://github.com/jsx-eslint/eslint-plugin-react
   - `eslint-plugin-react-hooks`: the Rules of Hooks and effect
     dependencies. https://react.dev/reference/eslint-plugin-react-hooks
   - `eslint-plugin-jsx-a11y`: accessibility in JSX elements.
     https://github.com/jsx-eslint/eslint-plugin-jsx-a11y
   - `eslint-plugin-sonarjs`: bugs and code smells, such as duplicate
     branches, unreachable code, and complexity.
     https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md

   **On ESLint 10, check the plugin's `eslint` peer range first.**
   `eslint-plugin-import`, `eslint-plugin-react`, and
   `eslint-plugin-jsx-a11y` have declared support only up to ESLint 9.
   For imports on ESLint 10, `eslint-plugin-import-x` declares support,
   https://github.com/un-ts/eslint-plugin-import-x.

   **A plugin the repo does not have is a new dependency.** Name the
   package and ask the user before adding it.

4. **No shipped rule fits: check the repo's own rules.** Read
   `customRules` for `eslint` in `detect --json`.
   - **A `count` of 5 or more:** you may write a new rule. Read the
     rules in `evidence` first and model yours on them: their file
     layout, how they are registered in the config, and their tests.
   - **Fewer than 5, `"unknown"`, or none:** do not write a custom
     rule. Return to `%(TASKLESS_CLI)s agent route`.

5. **Report, and say who runs it.** Show the file you changed and the
   command that shows the rule firing, e.g. `eslint <path>` or the
   repo's lint script. `%(TASKLESS_CLI)s check` does NOT run ESLint.

## Important Notes

- Do not list or recommend individual plugin rules from memory. Read
  the plugin's docs for the version installed.
- A preset (`js.configs.recommended`, `tseslint.configs.recommended`)
  is a set of rules someone else chose. Adding one to solve one request
  turns on many others; enable the single rule instead.

## See Also

- `%(TASKLESS_CLI)s agent route`: continue down the legacy ladder when no ESLint rule fits
- `%(TASKLESS_CLI)s agent create-sg-rule`: ast-grep parses JavaScript and TypeScript
