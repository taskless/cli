---
"@taskless/cli": patch
---

Every `taskless agent <topic>` recipe now opens with the rule the installed skill already states: run each Taskless command as its own shell call, with nothing chained to it, and write files with your file tools. Agents copy a recipe's own examples, so two that chained a command were rewritten: `check` now runs `git diff --name-only` separately instead of substituting it, and `create-vale-rule` measures one rule with `check --json --rule <id>` instead of piping into `jq`. Every topic version is bumped, so a cached recipe is refetched.
