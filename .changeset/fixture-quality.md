---
"@taskless/cli": patch
---

The rule-authoring recipes now tell the agent where a rule's test cases should come from. `create-sg-rule`, `create-vale-rule`, `create-runtime-rule`, and `improve-rule --anonymous` have it copy cases from real code in the repository before inventing any, and name the cases it invented in its report. They also have it read the linters `detect --json` finds and write cases those linters would accept. Apart from the construct the rule checks, cases stay in the repository's idiom, with no placeholder types such as `Record<string, never>` and no nesting a reviewer would send back. `create-remote-rule` and `improve-rule` apply the same standard to the cases and references they send to the generator. `verify` is unchanged and does not judge fixture style.
