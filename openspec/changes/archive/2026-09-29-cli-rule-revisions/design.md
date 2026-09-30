## Context

`rule restore` and `rule rollback` already talk to v2 through `packages/cli/src/api/v2.ts`. Each
call there returns a `V2Outcome` and never throws for a condition the service documents, and
`packages/cli/src/rules/recover.ts` turns a failed outcome into the `CLIError` a command
reports. The new endpoint (see proposal.md, Why) is a `GET` with `repositoryUrl` and optional
`orgId` in the query. It answers `200 { ruleId, revisions[], truncated }`, or `400
validation_error`, `401`, or `404 organization_not_found | rule_not_found`. It has no plan
refusal: the listing carries no bytes, so the service never reads the plan for it.

## Goals / Non-Goals

**Goals:**

- A revision id an agent can pass to `rule rollback` without leaving the terminal.
- The listing fits the existing recovery surface: the same identity resolution, the same error
  codes, and a `--json` shape parsed from a schema, as `rules-recover.ts` is.

**Non-Goals:**

- **Marking which revision is on disk.** That would need a reconcile round trip, meaning a
  snapshot and report of the whole tree, to annotate a read-only listing. `current` is the
  service's answer to "what should be on disk", and `check` already reports when the disk
  disagrees.
- **Interactive selection in `rollback`.** Agents drive these commands, and an optional
  `<revisionId>` that opens a prompt would behave differently in CI than at a terminal.
  `rollback` keeps both arguments required.
- **Paging past the cap.** The service caps the listing at ten and does not page. `truncated`
  sends the user to the dashboard, which lists every revision.

## Decisions

**A separate `rule revisions` command, not a listing mode of `rollback`.** Listing is read-only
and works on every plan, while rollback writes files and is plan-gated. Keeping them as
separate commands means a Free-plan user can see their revision history. It also means
nothing about `rollback --json` changes shape. The alternative, `rollback <id>` with no
revision printing the list, would make one command's output mean two different things
depending on how many arguments it got.

**`listRevisions` in `v2.ts` goes through `settle` with a completeness-checked code list.**
Its codes are `errorCodes<ErrorCode<"/cli/api/v2/rule/{ruleId}/revisions","get">>()`, so a
later schema refresh that adds a code fails `tsc` here. It accepts the body with a small
guard (`ruleId` string, `revisions` array, `truncated` boolean). Anything else is
`unavailable`, never an empty listing: an empty list read from a malformed body would tell
the user the rule has no history.

**Error mapping reuses `failure()` in `recover.ts`, with one message changed for
`rule_not_found`.** On restore, the service also answers `rule_not_found` for a rule that
exists only on an open pull request, and the restore message says so. The revisions endpoint
has no such case: it lists a PR-only rule, with no revision marked `current` (taskless/taskless
#261's own spec, "A rule with no current revision marks none"). So the listing reports
`RULE_NOT_FOUND` as "not a rule Taskless issued for this repository", without the
pull-request clause. `failure()` takes an optional override for that one message rather than
being copied.

**Identity and output go through the same scaffolding as the other recovery commands.**
`runRecovery` is specific to recovery, because its success path is a `Recovered` write. So
the new command resolves identity and reports errors the same way `runRecovery` does, by
factoring out its `report` / `resolveIdentity` prelude. Its success path prints the listing.
Two copies of the prelude does not meet the threshold for a shared helper. If a third caller
appears, that is the time to extract one.

**`--json` passes the service's revision objects through, parsed by its schema.**
The `outputSchema` in `schemas/rules-revisions.ts`, internal like `rules-recover.ts`, declares every field the service
documents, with `prUrl` optional. The output is `schema.parse(...)` of the assembled
object, as the other recovery commands do. This keeps the output to exactly what is
declared, so a field the service adds later does not leak into our output unannounced.

**The recipe topic moves from v1 to v2.** `recover-rule.md` gains a step: to roll back, run
`rule revisions <ruleId> --json`, pick the revision the user described, and pass its
`revisionId` to `rule rollback`. The Errors table's `REVISION_NOT_FOUND` fix becomes "list them
with `rule revisions`". The recipe is edited by hand and never run through prettier.

## Risks / Trade-offs

- [The service raises the cap or changes the ordering] → The CLI prints whatever order the
  service returns and finds the current revision by its flag, so neither change breaks it.
  The spec says so explicitly, so a later "sort by date" refactor is caught in review.
- [`createdAt` format drifts] → It is printed as received, not parsed, so a format change
  cannot crash the listing.
- [The regenerated `api-v2.d.ts` comes out unformatted] → `generate:api` writes it
  unformatted, and the committed file is prettier-formatted. Format it by explicit path
  after every refresh. The schema diff for this change is the one added path.
