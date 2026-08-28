---
name: taskless
description: |
  Use for any Taskless task. Trigger when the user mentions Taskless by name,
  or when their request involves the .taskless/ directory or files in it
  (rules, rule-tests, rule-metadata).

  Specifically:
  - "create/add/write a taskless rule for X"
  - "improve/fix/iterate on this taskless rule"
  - "delete/remove this taskless rule"
  - "run taskless", "taskless check", "validate against taskless rules"
  - "taskless login/logout/status", "is taskless connected"
  - "add taskless to CI", "wire taskless into github actions"
  - "onboard with taskless", "set up taskless for this project"

  Also trigger on any request to add/write/create a lint or code rule,
  including ones that name a specific tool (eslint, ruff, biome, stylelint,
  ast-grep). Naming a tool ENGAGES this skill's routing flow via
  `npx @taskless/cli agent route`; it does NOT suppress the skill.
metadata:
  type: shim
---

This is a Taskless reference stub. The canonical skill is defined at `.taskless/skills/taskless/SKILL.md`.

Read `.taskless/skills/taskless/SKILL.md` and follow its instructions.

If `.taskless/skills/taskless/SKILL.md` does not exist, run `npx @taskless/cli init` from the project root to restore it, then read it.
