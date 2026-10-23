---
"@taskless/cli": patch
---

Rules for a linter the repository already runs now follow a fixed order. The agent first looks for a rule the linter already ships, checking each tool's catch-all rules by name (`no-restricted-syntax`, `banned-api`, `noRestrictedImports`, and others). It writes a new custom rule in that linter only when the repository already has five or more of its own to model it on. Otherwise the request becomes a Taskless rule. `route` (topic v8) no longer asks the user to choose between a linter rule and a Taskless rule, and it describes each linter `detect` found in the repository. During onboarding (topic v11), the agent only enables rules the repository's installed packages already ship.

`detect --json` reports `customRules` for ESLint, Biome, pylint, flake8, and Ruff: how many rules the repository wrote itself for that linter, and where they are. A count that cannot be read without running a JavaScript config is reported as `"unknown"`.

`taskless agent create-legacy-rule --tool=<name>` serves a recipe for one linter, named as `detect` reports it: `ruff`, `eslint` (including typescript-eslint), `biome`, `pylint`, or `flake8`. Each recipe names the tool's catch-all rules, says how to confirm a rule exists in the installed version (`ruff rule`, `biome explain`, `pylint --help-msg`), and covers the traps that make a rule silently not fire, such as Ruff preview rules and ESLint 10's removal of `.eslintrc`. The ESLint recipe also lists eight well-known plugins, each with a docs link. Other tool names fall back to the generic recipe. `ast-grep`, `vale`, `prettier`, and `black` are refused with a pointer to the right recipe. `route` now names the `--tool` command for each linter it describes.
