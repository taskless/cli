---
"@taskless/cli": patch
---

Stop telling a new project its rules are out of date. Installing from the terminal never recorded that a new project had nothing to reconcile, so the first `agent ok` during onboarding asked for `update --rules` on a project with no rules. Installing now records it, and upgrading clears the message on any project that already has it and still has no rules.
