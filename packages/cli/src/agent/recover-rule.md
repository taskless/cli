# Topic: recover-rule     (CLI v%(CLI_VERSION)s / topic v3)

## Goal
Put an issued rule back the way Taskless issued it, after `check`
reported it edited or missing, or make an earlier revision of a rule
current again. Both commands verify every byte before writing it and
write nothing they cannot verify.

- `%(TASKLESS_CLI)s rule restore <ruleId>` repairs a rule to the version
  `check` compared it against. Use it when `check` says a rule was
  edited (`unsafe`) or is missing.
- `%(TASKLESS_CLI)s rule rollback <ruleId> <revisionId>` makes an
  earlier revision the rule's current one and writes it. Use it only
  when the user asks to go back to a specific revision; take the
  revision id from `rule revisions` (see Rolling back).
- `%(TASKLESS_CLI)s rule revisions <ruleId>` lists the rule's recent
  revisions and marks the current one. It reads only, and it works on
  every plan.

`check` never does either. It reports and names `rule restore`, or,
when the organization's plan does not include recovery, the git steps
that do the same job (see "When the plan does not include recovery").

**Check the plan before offering either command.** The CLI knows the
plan from the same login lookup it already makes, and says so in what
it prints:

- `check` gives git steps ("Restoring rules is not included in your
  organization's plan, so recover … from git") where it would name
  `rule restore`.
- `rule revisions` ends with "Rolling back is not included in your
  organization's plan" where it would name `rule rollback`.

When either appears, the plan does not include recovery. Follow the
git steps instead of running `rule restore` or `rule rollback`, which
the service refuses on this plan. When `check` names `rule restore`,
the plan includes recovery or could not be read; run the commands as
below, and the service's answer settles it.

## Preconditions
- User is logged in, and the project has a GitHub `origin`. Recovery
  addresses a rule Taskless issued for this repository.
- `<ruleId>` is the rule's directory name under
  `.taskless/rules/<engine>/` (for example `no-eval-3fa9c21b`), as
  `check --json` lists it in `integrity`. A rule written locally, or
  one generated before CLI 0.12.0, was never issued and cannot be
  recovered this way.

## Steps

1. **Take the rule id from `check`.** Under `--json`, each entry in
   `integrity` with `verdict` `unsafe` or `missing` names a rule
   `rule restore` repairs. An `unknown` entry with a `copyOf` is a copy
   of an issued rule under a new id: restore `copyOf.ruleId` (the
   source), never the copy's own id, then delete the copy's directory.

2. **Restore it.**
   ```
   %(TASKLESS_CLI)s rule restore <ruleId> --json
   ```
   The CLI asks the service what the rule should be, fetches it, checks
   every file against its signature and against that expectation, and
   replaces the rule directory (fixtures included) only if all of it
   matches.

3. **Read the result.**
   - `success: true` with a `revisionId`: the rule is back. Run
     `%(TASKLESS_CLI)s check` to confirm it verifies.
   - `success: true` with empty `files`: the rule was already intact
     (or is withheld only because of the plan). Nothing was written.
   - `ok: false`: see Errors. Nothing was written.

4. **Do not hand-edit the rule to match instead.** An edited issued rule
   is what an agent tuning a rule until its own violation passes looks
   like; `check` refuses it for that reason. If the edit was wanted,
   improve the rule through the service
   (`%(TASKLESS_CLI)s agent improve-rule`) or write a new local rule
   under a new id.

## Rolling back

1. **List the revisions.**
   ```
   %(TASKLESS_CLI)s rule revisions <ruleId> --json
   ```
   `revisions` is newest first, each with `revisionId`, `createdAt`,
   `delivery`, and `prUrl` for a pull-request delivery. Find the
   current one by `current: true`, not by position: a current revision
   older than the newest ten is listed after them. When no entry is
   current, the rule exists only on a pull request that has not merged,
   and there is nothing to roll back from. `truncated: true` means
   older revisions exist that the listing omits; the rule's page on
   the Taskless dashboard lists every one.

2. **Pick the revision the user described**, such as "the one before
   the last change" or "the one from that pull request". If more than
   one fits, show the user the candidates and ask. Do not guess.

3. **Roll back to it.**
   ```
   %(TASKLESS_CLI)s rule rollback <ruleId> <revisionId> --json
   ```
   Read the result the way restore's is read ("Read the result" under
   Steps), then run `%(TASKLESS_CLI)s check`.

## When the plan does not include recovery

If `check` or `rule revisions` already said the plan does not include
recovery, use the git steps `check` gave. Choosing the commit is covered
in `%(TASKLESS_CLI)s agent check`, under "When the plan does not include
restoring rules". To go back to an earlier revision on such a plan,
find the commit in `git log -- <rule directory>`; `rule revisions`
still lists when each revision was created and its pull request, which
helps match a revision to a commit.

If you ran restore or rollback anyway, or the plan could not be read
beforehand, the service answers with
guidance instead of a rule: `RULE_RECOVERY_NOT_IN_PLAN`, and a
`message` that names the plan, says the rule is in the repository's git
history, and gives the `git log` / `git restore` commands for the rule's
directory. That is the recovery path: show the user the message and
follow it, then run `check` again. Do not retry the command, since it
gives the same answer every time, and do not report it as an outage.
The message ends with an upgrade link when the service sent one.

## Errors

When `--json` is set, failures emit `{ ok: false, code, message }`:

| code                        | meaning                                               | fix                                                   |
|-----------------------------|-------------------------------------------------------|-------------------------------------------------------|
| `AUTH_REQUIRED`             | not logged in, or the token was rejected              | fetch `%(TASKLESS_CLI)s agent auth`                   |
| `RULE_RECOVERY_NOT_IN_PLAN` | the plan does not include recovery                     | follow the git steps in `message`; do not retry       |
| `RULE_NOT_FOUND`            | Taskless did not issue this rule for this repository  | check the id; a local rule cannot be restored         |
| `REVISION_NOT_FOUND`        | rollback named a revision that is not this rule's     | list them with `%(TASKLESS_CLI)s rule revisions <ruleId>` |
| `RULE_RESTORE_MISMATCH`     | the service served bytes other than the expected ones | nothing was written; report it, do not retry blindly  |
| `RULE_ID_AMBIGUOUS`         | two engines hold this id                               | rename the local one, then restore                    |
| `NETWORK_ERROR`             | the service could not be reached or failed            | report and suggest a retry                            |

`RULE_RESTORE_MISMATCH` protects the rule: restore repairs a rule to
what `check` compared it against and never advances it to a newer
revision. If the user wants the newer revision, that is
`%(TASKLESS_CLI)s agent improve-rule` or a rollback, chosen on purpose.

## See Also

- `%(TASKLESS_CLI)s agent check`: what `unsafe` and `missing` mean
- `%(TASKLESS_CLI)s agent improve-rule`: change an issued rule on purpose
