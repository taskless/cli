---
"@taskless/cli": patch
---

`taskless check` stops suggesting `taskless rule restore` to an organization whose plan does not include restoring rules. For an edited or missing rule, and for a renamed one, it gives the `git log` and `git restore` steps for the rule's directory instead, so a user is no longer sent to run a command the service will refuse. The plan is read from the `whoami` call the CLI already makes, so no request is added. When the plan is unknown, the suggestion is `rule restore` as before, and `rule restore` still asks the service on every plan.
