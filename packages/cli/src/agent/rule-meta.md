# Topic: rule-meta     (CLI v%(CLI_VERSION)s / topic v3)

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

`rule improve` needs the ticket id, and that id comes from the machine
that created the rule, not from disk:

- `%(TASKLESS_CLI)s rule create --json` prints it as `ruleId` on
  success. Record it when you create a rule you expect to iterate on.
- If the id was not recorded, ask the user for it.
- If nobody has it, iterate locally: fetch
  `%(TASKLESS_CLI)s agent improve-rule --anonymous`.

## Errors

| code                    | meaning                                  | fix                                   |
|-------------------------|------------------------------------------|---------------------------------------|
| `RULE_META_UNAVAILABLE` | no sidecar exists, and none is written   | Use the ticket id from `rule create`  |
| `INVALID_INPUT`         | a sidecar exists and is malformed         | Delete it; nothing here depends on it |

## See Also

- `%(TASKLESS_CLI)s agent improve-rule`: how the ticket id is actually sourced
