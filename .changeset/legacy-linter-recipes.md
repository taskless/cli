---
"@taskless/cli": patch
---

Rules for a linter the repository already runs now follow a fixed order. The agent first looks for a rule the linter already ships, checking each tool's catch-all rules by name (`no-restricted-syntax`, `banned-api`, `noRestrictedImports`, and others). It writes a new custom rule in that linter only when the repository already has five or more of its own to model it on. Otherwise the request becomes a Taskless rule. `route` (topic v8) no longer asks the user to choose between a linter rule and a Taskless rule, and it describes each linter `detect` found in the repository. During onboarding (topic v11), the agent only enables rules the repository's installed packages already ship.

`detect --json` reports `customRules` for ESLint, Biome, pylint, flake8, and Ruff: how many rules the repository wrote itself for that linter, and where they are. A count that cannot be read without running a JavaScript config is reported as `"unknown"`.
