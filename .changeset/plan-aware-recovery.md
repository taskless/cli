---
"@taskless/cli": patch
---

`taskless check` stops suggesting `taskless rule restore` to an organization whose plan does not include restoring rules. For an edited or missing rule, and for a renamed one, it gives the `git log` and `git restore` steps for the rule's directory instead, so a user is no longer sent to run a command the service will refuse. The plan is read from the `whoami` call the CLI already makes, so no request is added. When the plan is unknown, the suggestion is `rule restore` as before, and `rule restore` still asks the service on every plan.

`taskless rule revisions` lists a rule's revisions on every plan as before, but on a plan without rule recovery its closing line says rolling back is not included instead of naming `taskless rule rollback`. The `check` and `recover-rule` agent recipes tell an agent to read which recovery the CLI offered before running `rule restore` or `rule rollback`.
