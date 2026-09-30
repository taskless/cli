## Why

`taskless rule rollback <ruleId> <revisionId>` needs a revision id, and nothing in the CLI can
produce one. The `recover-rule` recipe sends the user to the dashboard's rule history to copy
it, so an agent asked to "roll this rule back to the last version" cannot finish without a
human opening a browser. The service now lists a rule's revisions
(`GET /cli/api/v2/rule/{ruleId}/revisions`, taskless/taskless#261, closing #253), deployed
and published in the v2 `__schema` as of 2026-09-30.

## What Changes

- New command `taskless rule revisions <ruleId> [--json]`. It is read-only, needs
  authentication and a resolvable repository like `rule restore`, and works on every plan:
  the listing carries no rule bytes, so the service does not read the plan for it.
- Human output lists the revisions newest first, marking the current one and showing
  when each was generated, how it was delivered, and its pull request when there is one. It
  says when older revisions were omitted, and where to see them.
- `--json` prints the listing with its `current` flags and `truncated`, so an agent can pick
  a revision and pass it to `rule rollback`.
- `REVISION_NOT_FOUND`'s remedy and the `recover-rule` recipe point at `rule revisions`
  instead of the dashboard. `rule rollback`'s arguments and behavior do not change.
- The vendored `api-v2.schema.json` / `api-v2.d.ts` pick up the one new path. The refresh is
  purely additive.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `cli-rule-recovery`: adds a requirement for listing a rule's revisions, and for the
  listing's `--json` shape and errors. Existing requirements are untouched; the change is
  an ADDED requirement, not a MODIFIED one.

## Impact

- `packages/cli/src/api/v2.ts`: a `listRevisions` call beside `restoreRule` / `rollbackRule`.
- `packages/cli/src/rules/recover.ts`: the listing, reusing its failure mapping.
- `packages/cli/src/commands/rules.ts`: the `revisions` subcommand.
- `packages/cli/src/schemas/`: an output schema for `rule revisions --json`, published
  through `@taskless/cli/schemas` like the others.
- `packages/cli/src/agent/recover-rule.md`: the topic version is bumped, and it gains a
  step for choosing a revision.
- `packages/cli/src/generated/api-v2.*`: the regenerated contract.

**Delivery shape: single PR.** The whole change is one command over one read-only endpoint,
together with its recipe text and tests, which fits well inside one reviewable diff. It does
not touch anything a published version depends on, so there is nothing to stack.
