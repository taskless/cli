## Why

A rule-generation request can produce more than one rule. The CLI verified every rule's signatures before writing any of them, but the other checks on a served rule (its id, its engine, and its file set's paths and completeness) ran inside the write loop. So when the second rule was refused, the first was already in `.taskless/rules/`, while the command failed and reported no rules. Under `--json`, those refusals also surfaced as `INTERNAL_ERROR` rather than a coded failure (#623).

## What Changes

- Split the write of a served rule into a check step that writes nothing and a write step.
- `rule create` and `rule improve` run the check step for every rule the request produced before writing the first, so a refused rule leaves the tree as it was.
- A refused generated rule reports `RULE_GENERATION_FAILED` (or `RULE_UNSUPPORTED` for an unknown engine) rather than `INTERNAL_ERROR`.
- `rule restore` and `rule rollback` deliver one rule and behave as before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-generated-rule-delivery`: a request's rules are delivered all or nothing against every pre-write check, not only signatures.

## Impact

- `packages/cli/src/rules/files.ts` (`prepareServedRule`, `writePreparedRule`) and `packages/cli/src/rules/generate.ts` (`deliverRevisions`).
- Out of scope: an IO failure part-way through the writes can still leave earlier rules written. Making the writes themselves atomic is separate work.
- Delivery shape: **single PR**. The split, its one caller, and the tests fit one review.
