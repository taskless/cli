# Topic: rule-meta     (CLI v%(CLI_VERSION)s / topic v4)

## Goal
Report what `%(TASKLESS_CLI)s rule meta` does today, so no recipe and no
agent builds a step on top of it.

## The sidecar does not exist

`.taskless/rule-metadata/<id>.yml` is written from the `meta` block of a
rule status response. The rule service does not populate that block, so
this CLI has never written a sidecar for any rule, under any tier, in
any mode. `rule meta <id>` therefore has nothing to read and exits 1
with `RULE_META_UNAVAILABLE` for every id, including ids whose rule is
plainly on disk.

That code exists to keep the two cases apart. `RULE_NOT_FOUND` invites a
retry with a different id; there is no id that works.

## What to do instead

Nothing you would have used it for needs it. `rule improve`,
`rule restore`, and `rule rollback` take a rule's id, and the id is the
rule's directory name under `.taskless/rules/<engine>/`, which is on
disk. `%(TASKLESS_CLI)s rule create --json` lists the same ids in
`rules`.

## Errors

| code                    | meaning                                  | fix                                   |
|-------------------------|------------------------------------------|---------------------------------------|
| `RULE_META_UNAVAILABLE` | no sidecar exists, and none is written   | Use the rule's directory name         |
| `INVALID_INPUT`         | a sidecar exists and is malformed         | Delete it; nothing here depends on it |

## See Also

- `%(TASKLESS_CLI)s agent improve-rule`: iterating a rule by its id
