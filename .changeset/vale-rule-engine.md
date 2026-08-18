---
"@taskless/cli": minor
---

Add Vale as a second static-tier rule engine, give every engine one rule layout, and rename the agent-facing command.

`check` now dispatches by engine and runs ast-grep, Vale, and runtime rules
concurrently, merging their findings into one result set. An unavailable Vale
reports itself and the other engines still return. A Vale that times out or
rejects its config fails the check rather than passing as a clean run.

**Every rule is now one directory**, `.taskless/rules/<engine>/<id>/`, holding
the rule, any per-engine config, and its tests in `.tests/`. Writing a rule
means creating a directory and deleting one means `rm -rf`. Nothing outside it
is touched either way, so concurrent authors never collide on a shared file.

Vale rules carry their own `.vale.ini` declaring which files they apply to.
The single config Vale reads is assembled from those per-rule files on each
run, gitignored, and regenerated, so hand edits to it have no effect. ast-grep
keeps its `files`/`ignores` inside the rule and needs no second file.

**`rule verify` is replaced by two path-addressed commands.** `verify <path>`
checks that a rule has the components its engine requires and needs no tests,
so it works while you're still authoring. `test <path>` runs the rule's tests,
after running `verify` and stopping if that fails. Both take a rule directory,
an engine directory, or nothing at all for the whole project, and both report
one result per rule. Addressing by path rather than id removes the ambiguity
that arose when two engines held the same rule id.

Projects on an older layout migrate automatically on the next command.

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
its criterion is stated once, in `route`. Every authoring recipe is rewritten
for the rule-directory layout.

**BREAKING for `@taskless/cli/prompts` consumers.** `engine-selection` is no
longer exported. `TOPICS` is now `create-sg-rule`, `create-vale-rule`, and
`create-runtime-rule`, so a consumer that decides an engine can reach the
procedure for each destination. Because the export is a string union, a
consumer passing the removed name dynamically breaks on upgrade rather than at
build time.
