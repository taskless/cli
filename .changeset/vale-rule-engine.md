---
"@taskless/cli": minor
---

Add Vale as a second static-tier rule engine, and rename the agent-facing command.

`check` now dispatches by engine and runs ast-grep, Vale, and runtime rules
concurrently, merging their findings into one result set. An unavailable Vale
reports itself and the other engines still return. A Vale that times out or
rejects its config fails the check rather than passing as a clean run.

**BREAKING: `taskless help <topic>` is now `taskless agent <topic>`.** The
command is named for who reads it. Agents fetching a procedure are not asking
for help, and the old name is gone rather than aliased.

**BREAKING: topics are addressed by a single token.** `taskless help rule
create` becomes `taskless agent create-sg-rule`; multiple positionals are no
longer joined into a topic key. A topic name is now a literal string an agent
copies rather than a phrase it can reorder. The renames:

| Was                | Now                                     |
| ------------------ | --------------------------------------- |
| `rule create`      | `create-sg-rule` / `create-remote-rule` |
| `rule improve`     | `improve-rule`                          |
| `rule delete`      | `delete-rule`                           |
| `rule verify`      | `verify-rule`                           |
| `rule meta`        | `rule-meta`                             |
| `static`           | `create-sg-rule`                        |
| `existing`         | `create-legacy-rule`                    |
| `engine-selection` | `route`                                 |

`route` now applies the engine reasoning itself and names a concrete
`create-*-rule` topic, so `engine-selection` is removed rather than renamed —
its criterion is stated once, in `route`.

**BREAKING for `@taskless/cli/prompts` consumers.** `engine-selection` is no
longer exported. `TOPICS` is now `create-sg-rule`, `create-vale-rule`, and
`create-runtime-rule`, so a consumer that decides an engine can reach the
procedure for each destination. Because the export is a string union, a
consumer passing the removed name dynamically breaks on upgrade rather than at
build time.
