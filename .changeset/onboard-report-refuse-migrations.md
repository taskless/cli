---
"@taskless/cli": patch
---

`taskless onboard` and `taskless report` no longer migrate `.taskless/` as a side effect. On a project whose scaffold is behind the CLI they now refuse with `SCAFFOLD_MIGRATION_REQUIRED` and ask you to run `taskless init`, the same way `check`, `validate` and `verify` do. Before, fetching the onboarding recipe or drafting a report could move and delete tracked files under `.taskless/` without saying so. A project with no `.taskless/` yet is set up exactly as before.
