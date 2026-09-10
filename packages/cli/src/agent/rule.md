# Topic: rule     (CLI v%(CLI_VERSION)s / topic v2)

## Goal
Umbrella for rule operations. Fetch the topic for the action you want.

## Topics

| Action             | Recipe                                                |
|--------------------|-------------------------------------------------------|
| Create a rule      | `%(TASKLESS_CLI)s agent route`                        |
| Improve a rule     | `%(TASKLESS_CLI)s agent improve-rule`                 |
| Delete a rule      | `%(TASKLESS_CLI)s agent delete-rule`                  |
| Verify a rule      | `%(TASKLESS_CLI)s agent verify-rule` (agent-internal) |
| Read rule metadata | `%(TASKLESS_CLI)s agent rule-meta`   (agent-internal) |

`rule meta` reads a sidecar this CLI never writes, so it fails for every
rule. Fetch `rule-meta` only to learn what to do instead. `improve-rule`
takes the ticket id from `rule create --json`.

`route` is the entry point for authoring: it reads the request and
names the `create-*-rule` topic that fits, so you do not pick an engine
yourself.

For the local-only flow on improve, append `--anonymous`.

## See Also

- `%(TASKLESS_CLI)s agent check`: run all configured rules
